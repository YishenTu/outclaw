import type { ReactNode } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react";
import {
	canonicalizePromptSlashCommand,
	isRuntimeCommand,
} from "../../../common/commands.ts";
import {
	extractError,
	parseMessage,
	type ServerEvent,
} from "../../../common/protocol.ts";
import {
	isRuntimeSocketOpen,
	openRuntimeSocket,
	sendRequestSkills,
	sendRuntimeCommand,
	sendRuntimePrompt,
} from "../../runtime-client/index.ts";
import type { ComposerImageAttachment } from "../components/chat/composer-images.ts";
import { fetchSidebarSummary, uploadPromptImages } from "../lib/api.ts";
import {
	createLiveRunSessionRouter,
	pinLiveRunSessionKey,
	routeLiveRunSessionKey,
} from "../live-run-session.ts";
import {
	applySidebarSummary,
	handleBrowserServerEvent,
} from "../runtime-server-events.ts";
import { dispatchBrowserPrompt as dispatchBrowserPromptMessage } from "../send-browser-prompt.ts";
import {
	sendBrowserPromptToAgent as dispatchBrowserPromptToAgent,
	sendPromptToAgent as dispatchPromptToAgent,
} from "../send-prompt-to-agent.ts";
import { resolveCurrentBrowserSessionKey } from "../session.ts";
import { createSidebarRefreshGate } from "../sidebar-refresh-gate.ts";
import type { AgentEntry } from "../stores/agents.ts";
import { useAgentsStore } from "../stores/agents.ts";
import { useChatStore } from "../stores/chat.ts";
import { useRuntimeStore } from "../stores/runtime.ts";
import {
	type SessionEntry,
	type SessionRef,
	useSessionsStore,
} from "../stores/sessions.ts";

export interface WebSocketContextValue {
	ws: WebSocket | null;
	connected: boolean;
	connectionStatus: "connecting" | "connected" | "disconnected";
	sendPrompt: (prompt: string) => boolean;
	sendBrowserPrompt: (
		prompt: string,
		images?: ComposerImageAttachment[],
	) => Promise<boolean>;
	sendBrowserPromptToAgent: (
		agent: AgentEntry,
		prompt: string,
		images?: ComposerImageAttachment[],
		session?: SessionRef | null,
	) => Promise<boolean>;
	sendPromptToAgent: (agent: AgentEntry, prompt: string) => boolean;
	sendCommand: (command: string) => boolean;
	switchAgent: (agentName: string) => boolean;
	switchSession: (agentName: string, session: SessionEntry) => boolean;
	refreshSidebar: () => void;
}

const WebSocketContext = createContext<WebSocketContextValue>({
	ws: null,
	connected: false,
	connectionStatus: "connecting",
	sendPrompt: () => false,
	sendBrowserPrompt: async () => false,
	sendBrowserPromptToAgent: async () => false,
	sendPromptToAgent: () => false,
	sendCommand: () => false,
	switchAgent: () => false,
	switchSession: () => false,
	refreshSidebar: () => {},
});

export function useWs() {
	return useContext(WebSocketContext);
}

interface WebSocketProviderProps {
	children: ReactNode;
	value?: Partial<WebSocketContextValue>;
}

function buildBrowserRuntimeUrl(): string {
	if (typeof window === "undefined") {
		return "ws://localhost:3000/ws";
	}

	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}/ws`;
}

function getActiveAgentId(): string | null {
	return useAgentsStore.getState().activeAgentId;
}

function getCurrentSessionKey(agentId: string): string {
	const activeSession =
		useSessionsStore.getState().activeSessionByAgent[agentId] ?? null;
	const runtime = useRuntimeStore.getState();
	return resolveCurrentBrowserSessionKey({
		agentId,
		activeSession,
		providerId: runtime.providerId ?? undefined,
		runtimeSessionId: runtime.sessionId,
	});
}

export function WebSocketProvider({ children, value }: WebSocketProviderProps) {
	const wsRef = useRef<WebSocket | null>(null);
	const liveRunSessionRef = useRef(createLiveRunSessionRouter());
	const sidebarRefreshGateRef = useRef(createSidebarRefreshGate());

	const pinObservedSessionKey = useCallback(
		(agentId: string, observedSessionId?: string) =>
			pinLiveRunSessionKey({
				agentId,
				fallbackSessionKey: getCurrentSessionKey(agentId),
				observedSessionId,
				providerId: useRuntimeStore.getState().providerId,
				router: liveRunSessionRef.current,
			}),
		[],
	);

	const routeObservedSessionKey = useCallback(
		(agentId: string, observedSessionId?: string) =>
			routeLiveRunSessionKey({
				agentId,
				fallbackSessionKey: getCurrentSessionKey(agentId),
				observedSessionId,
				providerId: useRuntimeStore.getState().providerId,
				router: liveRunSessionRef.current,
			}),
		[],
	);

	const sendCommand = useCallback((command: string): boolean => {
		const ws = wsRef.current;
		if (!isRuntimeSocketOpen(ws)) {
			useRuntimeStore.getState().setError("Runtime disconnected");
			return false;
		}

		try {
			sendRuntimeCommand(ws, command);
			return true;
		} catch (error) {
			useRuntimeStore.getState().setError(extractError(error));
			return false;
		}
	}, []);

	const refreshSidebar = useCallback(() => {
		const requestId = sidebarRefreshGateRef.current.startRequest();
		void fetchSidebarSummary()
			.then((summary) => {
				if (!sidebarRefreshGateRef.current.isCurrent(requestId)) {
					return;
				}
				applySidebarSummary(summary);
			})
			.catch((error) => {
				if (!sidebarRefreshGateRef.current.isCurrent(requestId)) {
					return;
				}
				useRuntimeStore.getState().setError(extractError(error));
			});

		const ws = wsRef.current;
		if (!isRuntimeSocketOpen(ws)) {
			return;
		}

		try {
			sendRequestSkills(ws);
		} catch (error) {
			useRuntimeStore.getState().setError(extractError(error));
		}
	}, []);

	const sendPrompt = useCallback(
		(input: string): boolean => {
			const trimmed = input.trim();
			if (trimmed === "") {
				return false;
			}

			if (isRuntimeCommand(trimmed)) {
				return sendCommand(trimmed);
			}

			const agentId = getActiveAgentId();
			const ws = wsRef.current;
			if (!agentId || !isRuntimeSocketOpen(ws)) {
				useRuntimeStore.getState().setError("Runtime disconnected");
				return false;
			}

			const prompt = canonicalizePromptSlashCommand(trimmed) ?? trimmed;

			try {
				sendRuntimePrompt(ws, prompt);
			} catch (error) {
				useRuntimeStore.getState().setError(extractError(error));
				return false;
			}

			const sessionKey = getCurrentSessionKey(agentId);
			liveRunSessionRef.current.pin(sessionKey);
			useChatStore.getState().pushMessage(sessionKey, {
				kind: "chat",
				role: "user",
				content: prompt,
				timestamp: Date.now(),
			});
			useChatStore.getState().startAssistantTurn(sessionKey);
			useChatStore.getState().setError(sessionKey, null);
			useRuntimeStore.getState().setError(null);
			return true;
		},
		[sendCommand],
	);

	const sendBrowserPrompt = useCallback(
		async (
			input: string,
			images: ComposerImageAttachment[] = [],
		): Promise<boolean> => {
			return await dispatchBrowserPromptMessage({
				input,
				images,
				getActiveAgentId,
				getCurrentSessionKey,
				getSocket: () => wsRef.current,
				isSocketOpen: isRuntimeSocketOpen,
				pinSession: (sessionKey) => {
					liveRunSessionRef.current.pin(sessionKey);
				},
				pushMessage: (sessionKey, message) => {
					useChatStore.getState().pushMessage(sessionKey, message);
				},
				sendCommand,
				sendPrompt: (ws, prompt, uploadedImages) => {
					sendRuntimePrompt(ws, prompt, undefined, uploadedImages);
				},
				setRuntimeError: (error) => {
					useRuntimeStore.getState().setError(error);
				},
				setSessionError: (sessionKey, error) => {
					useChatStore.getState().setError(sessionKey, error);
				},
				startAssistantTurn: (sessionKey) => {
					useChatStore.getState().startAssistantTurn(sessionKey);
				},
				uploadImages: uploadPromptImages,
			});
		},
		[sendCommand],
	);

	const sendPromptToAgent = useCallback(
		(agent: AgentEntry, prompt: string): boolean =>
			dispatchPromptToAgent({
				agent,
				activeAgentId: useAgentsStore.getState().activeAgentId,
				runtimeAgentName: useRuntimeStore.getState().agentName,
				clearRuntimeSession: useRuntimeStore.getState().clearSession,
				prompt,
				sendCommand,
				sendPrompt,
				setActiveAgent: useAgentsStore.getState().setActiveAgent,
				setAgentName: useRuntimeStore.getState().setAgentName,
			}),
		[sendCommand, sendPrompt],
	);

	const sendBrowserPromptToAgent = useCallback(
		(
			agent: AgentEntry,
			prompt: string,
			images: ComposerImageAttachment[] = [],
			session: SessionRef | null = null,
		): Promise<boolean> =>
			dispatchBrowserPromptToAgent({
				agent,
				activeAgentId: useAgentsStore.getState().activeAgentId,
				runtimeAgentName: useRuntimeStore.getState().agentName,
				clearRuntimeSession: useRuntimeStore.getState().clearSession,
				prompt,
				images,
				targetSession: session,
				runtimeProviderId: useRuntimeStore.getState().providerId,
				runtimeSessionId: useRuntimeStore.getState().sessionId,
				sendBrowserPrompt,
				sendCommand,
				setActiveAgent: useAgentsStore.getState().setActiveAgent,
				setAgentName: useRuntimeStore.getState().setAgentName,
			}),
		[sendBrowserPrompt, sendCommand],
	);

	const switchAgent = useCallback(
		(agentName: string): boolean => sendCommand(`/agent ${agentName}`),
		[sendCommand],
	);

	const switchSession = useCallback(
		(agentName: string, session: SessionEntry): boolean => {
			const runtime = useRuntimeStore.getState();
			if (
				runtime.agentName !== agentName &&
				!sendCommand(`/agent ${agentName}`)
			) {
				return false;
			}

			return sendCommand(`/session ${session.sdkSessionId}`);
		},
		[sendCommand],
	);

	const handleServerEvent = useCallback(
		(event: ServerEvent) => {
			handleBrowserServerEvent(event, {
				clearLiveRunSessions: () => {
					liveRunSessionRef.current.clear();
				},
				completeLiveRunSession: (nextSessionKey, currentSessionKey) =>
					liveRunSessionRef.current.complete(nextSessionKey, currentSessionKey),
				getActiveAgentId,
				getCurrentSessionKey,
				invalidateSidebarRefresh: () => {
					sidebarRefreshGateRef.current.invalidate();
				},
				pinObservedSessionKey,
				refreshSidebar,
				routeObservedSessionKey,
			});
		},
		[pinObservedSessionKey, refreshSidebar, routeObservedSessionKey],
	);

	useEffect(() => {
		let cancelled = false;
		let retryTimer: ReturnType<typeof setTimeout> | null = null;

		function connect() {
			if (cancelled) {
				return;
			}

			const socket = openRuntimeSocket(buildBrowserRuntimeUrl(), "browser");
			const { ws } = socket;
			wsRef.current = ws;
			useRuntimeStore.getState().setConnectionStatus("connecting");
			void socket.ready.catch(() => {
				// onclose handles reconnect scheduling.
			});

			ws.onopen = () => {
				useRuntimeStore.getState().setConnectionStatus("connected");
				useRuntimeStore.getState().setError(null);
				refreshSidebar();
			};

			ws.onclose = () => {
				if (cancelled) {
					return;
				}
				if (wsRef.current === ws) {
					wsRef.current = null;
				}
				useRuntimeStore.getState().setConnectionStatus("disconnected");
				retryTimer = setTimeout(connect, 3000);
			};

			ws.onerror = () => {
				// close will follow and schedule reconnect.
			};

			ws.onmessage = (message) => {
				handleServerEvent(parseMessage(String(message.data)) as ServerEvent);
			};
		}

		connect();

		return () => {
			cancelled = true;
			if (retryTimer) {
				clearTimeout(retryTimer);
			}
			wsRef.current?.close();
			wsRef.current = null;
		};
	}, [handleServerEvent, refreshSidebar]);

	useEffect(() => {
		if (typeof document === "undefined") {
			return;
		}

		const interval = setInterval(() => {
			if (document.visibilityState === "visible") {
				refreshSidebar();
			}
		}, 15_000);

		return () => clearInterval(interval);
	}, [refreshSidebar]);

	const connectionStatus = useRuntimeStore((state) => state.connectionStatus);

	const contextValue = useMemo<WebSocketContextValue>(
		() => ({
			ws: wsRef.current,
			connected: connectionStatus === "connected",
			connectionStatus,
			sendPrompt,
			sendBrowserPrompt,
			sendBrowserPromptToAgent,
			sendPromptToAgent,
			sendCommand,
			switchAgent,
			switchSession,
			refreshSidebar,
			...value,
		}),
		[
			refreshSidebar,
			connectionStatus,
			sendCommand,
			sendPrompt,
			sendBrowserPrompt,
			sendBrowserPromptToAgent,
			sendPromptToAgent,
			switchAgent,
			switchSession,
			value,
		],
	);

	return (
		<WebSocketContext.Provider value={contextValue}>
			{children}
		</WebSocketContext.Provider>
	);
}
