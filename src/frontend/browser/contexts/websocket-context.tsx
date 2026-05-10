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
import type { ComposerImageAttachment } from "../attachments/composer-images.ts";
import { createBrowserSwitchDispatcher } from "../commands/browser-switch-dispatcher.ts";
import { createBrowserLiveRunBridge } from "../events/browser-live-run-bridge.ts";
import { createBrowserSocketLifecycle } from "../events/browser-socket-lifecycle.ts";
import {
	applySidebarSummary,
	handleBrowserServerEvent,
} from "../events/runtime-server-events.ts";
import { useRuntimeLatencyPolling } from "../latency/use-runtime-latency.ts";
import { fetchSidebarSummary, uploadPromptImages } from "../lib/api.ts";
import { dispatchBrowserPrompt as dispatchBrowserPromptMessage } from "../prompts/send-browser-prompt.ts";
import { dispatchBrowserTextPrompt } from "../prompts/send-browser-text-prompt.ts";
import {
	sendBrowserPromptToAgent as dispatchBrowserPromptToAgent,
	sendPromptToAgent as dispatchPromptToAgent,
} from "../prompts/send-prompt-to-agent.ts";
import { resolveCurrentBrowserSessionKey } from "../sessions/session.ts";
import { createSidebarRefreshCoordinator } from "../sidebar/sidebar-refresh.ts";
import { createSidebarRefreshGate } from "../sidebar/sidebar-refresh-gate.ts";
import type { AgentEntry } from "../stores/agents.ts";
import { useAgentsStore } from "../stores/agents.ts";
import {
	shouldQueuePromptInChatSession,
	useChatStore,
} from "../stores/chat.ts";
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

function shouldQueuePromptForSession(sessionKey: string): boolean {
	const session = useChatStore.getState().getSession(sessionKey);
	if (shouldQueuePromptInChatSession(session)) {
		return true;
	}

	const activeAgentId = getActiveAgentId();
	return (
		activeAgentId !== null &&
		useRuntimeStore.getState().running &&
		getCurrentSessionKey(activeAgentId) === sessionKey
	);
}

export function WebSocketProvider({ children, value }: WebSocketProviderProps) {
	const wsRef = useRef<WebSocket | null>(null);
	const sidebarRefreshGateRef = useRef(createSidebarRefreshGate());
	const liveRunBridgeRef = useRef(
		createBrowserLiveRunBridge({
			getCurrentSessionKey,
			getProviderId: () => useRuntimeStore.getState().providerId,
		}),
	);
	useRuntimeLatencyPolling();

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

	const sidebarRefreshCoordinator = useMemo(
		() =>
			createSidebarRefreshCoordinator({
				applySidebarSummary,
				fetchSidebarSummary,
				gate: sidebarRefreshGateRef.current,
				getSocket: () => wsRef.current,
				isSocketOpen: isRuntimeSocketOpen,
				sendRequestSkills,
				setRuntimeError: (error) => {
					useRuntimeStore.getState().setError(error);
				},
			}),
		[],
	);

	const refreshSidebar = useCallback(() => {
		sidebarRefreshCoordinator.refresh();
	}, [sidebarRefreshCoordinator]);

	const sendPrompt = useCallback(
		(input: string): boolean =>
			dispatchBrowserTextPrompt({
				input,
				getActiveAgentId,
				getCurrentSessionKey,
				getSocket: () => wsRef.current,
				isSocketOpen: isRuntimeSocketOpen,
				pinSession: (sessionKey) => {
					liveRunBridgeRef.current.pinSession(sessionKey);
				},
				pushUserMessage: (sessionKey, message) => {
					useChatStore.getState().pushMessage(sessionKey, message);
				},
				queueUserMessage: (sessionKey, message) => {
					useChatStore.getState().queuePrompt(sessionKey, message);
				},
				sendCommand,
				sendPrompt: (ws, prompt) => {
					sendRuntimePrompt(ws, prompt);
				},
				setRuntimeError: (error) => {
					useRuntimeStore.getState().setError(error);
				},
				setSessionError: (sessionKey, error) => {
					useChatStore.getState().setError(sessionKey, error);
				},
				shouldQueuePrompt: shouldQueuePromptForSession,
				startAssistantTurn: (sessionKey, options) => {
					useChatStore.getState().startAssistantTurn(sessionKey, options);
				},
			}),
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
					liveRunBridgeRef.current.pinSession(sessionKey);
				},
				pushMessage: (sessionKey, message) => {
					useChatStore.getState().pushMessage(sessionKey, message);
				},
				queueMessage: (sessionKey, message) => {
					useChatStore.getState().queuePrompt(sessionKey, message);
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
				shouldQueuePrompt: shouldQueuePromptForSession,
				startAssistantTurn: (sessionKey, options) => {
					useChatStore.getState().startAssistantTurn(sessionKey, options);
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

	const switchDispatcher = useMemo(
		() =>
			createBrowserSwitchDispatcher({
				getRuntimeAgentName: () => useRuntimeStore.getState().agentName,
				sendCommand,
			}),
		[sendCommand],
	);

	const switchAgent = useCallback(
		(agentName: string): boolean => switchDispatcher.switchAgent(agentName),
		[switchDispatcher],
	);

	const switchSession = useCallback(
		(agentName: string, session: SessionEntry): boolean =>
			switchDispatcher.switchSession(agentName, session),
		[switchDispatcher],
	);

	const handleServerEvent = useCallback(
		(event: ServerEvent) => {
			handleBrowserServerEvent(event, {
				bindLiveRunSession: (nextSessionKey, currentSessionKey) =>
					liveRunBridgeRef.current.bindLiveRunSession(
						nextSessionKey,
						currentSessionKey,
					),
				clearLiveRunSessions: () => {
					liveRunBridgeRef.current.clearLiveRunSessions();
				},
				completeLiveRunSession: (nextSessionKey, currentSessionKey) =>
					liveRunBridgeRef.current.completeLiveRunSession(
						nextSessionKey,
						currentSessionKey,
					),
				getActiveAgentId,
				getCurrentSessionKey,
				invalidateSidebarRefresh: () => {
					sidebarRefreshCoordinator.invalidate();
				},
				pinObservedSessionKey: liveRunBridgeRef.current.pinObservedSessionKey,
				refreshSidebar,
				requestSkills: () => {
					const socket = wsRef.current;
					if (!isRuntimeSocketOpen(socket)) {
						return;
					}
					try {
						sendRequestSkills(socket);
					} catch (error) {
						useRuntimeStore.getState().setError(extractError(error));
					}
				},
				routeObservedSessionKey:
					liveRunBridgeRef.current.routeObservedSessionKey,
			});
		},
		[refreshSidebar, sidebarRefreshCoordinator],
	);

	useEffect(() => {
		const lifecycle = createBrowserSocketLifecycle<WebSocket>({
			applyEvent: handleServerEvent,
			openSocket: () => openRuntimeSocket(buildBrowserRuntimeUrl(), "browser"),
			onConnected: refreshSidebar,
			parseMessage: (data) => parseMessage(data) as ServerEvent,
			setConnectionStatus: (status) => {
				useRuntimeStore.getState().setConnectionStatus(status);
			},
			setCurrentSocket: (socket) => {
				wsRef.current = socket;
			},
			setRuntimeError: (error) => {
				useRuntimeStore.getState().setError(error);
			},
		});

		lifecycle.start();

		return () => lifecycle.stop();
	}, [handleServerEvent, refreshSidebar]);

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
