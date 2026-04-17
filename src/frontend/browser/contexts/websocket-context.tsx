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
	type BrowserAgentsResponse,
	extractError,
	parseMessage,
	type ServerEvent,
} from "../../../common/protocol.ts";
import { formatStatusCompact } from "../../../common/status.ts";
import {
	isRuntimeSocketOpen,
	openRuntimeSocket,
	sendRequestSkills,
	sendRuntimeCommand,
	sendRuntimePrompt,
} from "../../runtime-client/index.ts";
import { fetchSidebarSummary } from "../lib/api.ts";
import { formatObservedPrompt } from "../observed-prompt.ts";
import {
	createBrowserSessionRef,
	createSessionKey,
	resolveBrowserSessionKey,
} from "../session.ts";
import { useAgentsStore } from "../stores/agents.ts";
import { useChatStore } from "../stores/chat.ts";
import { useContextUsageStore } from "../stores/context-usage.ts";
import { useRuntimeStore } from "../stores/runtime.ts";
import { useRuntimePopupStore } from "../stores/runtime-popup.ts";
import {
	type SessionEntry,
	type SessionRef,
	useSessionsStore,
} from "../stores/sessions.ts";
import { useSlashCommandsStore } from "../stores/slash-commands.ts";

export interface WebSocketContextValue {
	ws: WebSocket | null;
	connected: boolean;
	connectionStatus: "connecting" | "connected" | "disconnected";
	sendPrompt: (prompt: string) => boolean;
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
	const providerId = useRuntimeStore.getState().providerId ?? undefined;
	return resolveBrowserSessionKey({
		agentId,
		activeSession,
		providerId,
	});
}

function getCurrentSessionRef(agentId: string): SessionRef | null {
	return useSessionsStore.getState().activeSessionByAgent[agentId] ?? null;
}

function applySidebarSummary(summary: BrowserAgentsResponse) {
	useAgentsStore.getState().setAgents(
		summary.agents.map((agent) => ({
			agentId: agent.agentId,
			name: agent.name,
		})),
	);

	if (!useAgentsStore.getState().activeAgentId && summary.activeAgentId) {
		useAgentsStore.getState().setActiveAgent(summary.activeAgentId);
	}

	for (const agent of summary.agents) {
		useSessionsStore.getState().setSessions(
			agent.agentId,
			agent.sessions.map(
				(session): SessionEntry => ({
					agentId: agent.agentId,
					providerId: session.providerId,
					sdkSessionId: session.sdkSessionId,
					title: session.title,
					model: session.model,
					lastActive: session.lastActive,
				}),
			),
		);
		useSessionsStore.getState().setActiveSession(
			agent.agentId,
			agent.activeSession
				? {
						agentId: agent.agentId,
						providerId: agent.activeSession.providerId,
						sdkSessionId: agent.activeSession.sdkSessionId,
					}
				: null,
		);
	}
}

function formatSessionListSummary(
	event: Extract<ServerEvent, { type: "session_list" }>,
): string {
	if (event.sessions.length === 0) {
		return "Sessions\nnone";
	}

	return `Sessions\n${event.sessions
		.map((session) => `${session.title}  ${session.model}`)
		.join("\n")}`;
}

function formatSessionInfoSummary(
	event: Extract<ServerEvent, { type: "session_info" }>,
): string {
	return `Session\n${event.title}\nmodel: ${event.model}\nid: ${event.sdkSessionId}`;
}

export function WebSocketProvider({ children, value }: WebSocketProviderProps) {
	const wsRef = useRef<WebSocket | null>(null);

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
		void fetchSidebarSummary()
			.then((summary) => {
				applySidebarSummary(summary);
			})
			.catch((error) => {
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
			useChatStore.getState().pushMessage(sessionKey, {
				kind: "chat",
				role: "user",
				content: prompt,
			});
			useChatStore.getState().startAssistantTurn(sessionKey);
			useChatStore.getState().setError(sessionKey, null);
			useRuntimeStore.getState().setError(null);
			return true;
		},
		[sendCommand],
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
			switch (event.type) {
				case "agent_menu":
					useRuntimePopupStore.getState().openAgentMenu(event);
					return;
				case "agent_switched": {
					useRuntimePopupStore.getState().closePopup();
					useAgentsStore.getState().setActiveAgent(event.agentId);
					useRuntimeStore.getState().setAgentName(event.name);
					useRuntimeStore.getState().clearSession();
					refreshSidebar();
					return;
				}
				case "runtime_status": {
					useRuntimeStore.getState().updateFromStatus(event);
					if (event.requested) {
						useRuntimePopupStore
							.getState()
							.openStatus(formatStatusCompact(event));
					}
					const agentId = getActiveAgentId();
					if (!agentId) {
						return;
					}

					useSessionsStore
						.getState()
						.setActiveSession(
							agentId,
							event.sessionId && event.providerId
								? createBrowserSessionRef(
										agentId,
										event.providerId,
										event.sessionId,
									)
								: null,
						);
					if (event.sessionId && event.usage) {
						const providerId =
							event.providerId ?? useRuntimeStore.getState().providerId;
						if (!providerId) {
							return;
						}
						useContextUsageStore
							.getState()
							.setUsage(
								createSessionKey(
									createBrowserSessionRef(agentId, providerId, event.sessionId),
								),
								event.usage,
							);
					}
					return;
				}
				case "session_menu":
					useRuntimePopupStore.getState().openSessionMenu(event);
					return;
				case "session_list":
					useRuntimePopupStore
						.getState()
						.openStatus(formatSessionListSummary(event));
					return;
				case "session_switched": {
					useRuntimePopupStore.getState().closePopup();
					const agentId = getActiveAgentId();
					const providerId = useRuntimeStore.getState().providerId;
					if (!agentId) {
						return;
					}
					useSessionsStore
						.getState()
						.setActiveSession(
							agentId,
							providerId
								? createBrowserSessionRef(
										agentId,
										providerId,
										event.sdkSessionId,
									)
								: null,
						);
					refreshSidebar();
					return;
				}
				case "session_renamed": {
					useRuntimePopupStore.getState().closePopup();
					refreshSidebar();
					return;
				}
				case "session_deleted": {
					useRuntimePopupStore.getState().closePopup();
					refreshSidebar();
					return;
				}
				case "session_cleared": {
					useRuntimePopupStore.getState().closePopup();
					const agentId = getActiveAgentId();
					if (!agentId) {
						return;
					}
					const sessionKey = getCurrentSessionKey(agentId);
					useSessionsStore.getState().setActiveSession(agentId, null);
					useChatStore.getState().clearSession(sessionKey);
					useRuntimeStore.getState().clearSession();
					return;
				}
				case "history_replay": {
					const agentId = getActiveAgentId();
					if (!agentId) {
						return;
					}

					const activeSession =
						getCurrentSessionRef(agentId) ??
						(useRuntimeStore.getState().sessionId &&
						useRuntimeStore.getState().providerId
							? createBrowserSessionRef(
									agentId,
									useRuntimeStore.getState().providerId as string,
									useRuntimeStore.getState().sessionId as string,
								)
							: null);
					if (!activeSession) {
						return;
					}

					useChatStore
						.getState()
						.replaceHistory(createSessionKey(activeSession), event.messages);
					return;
				}
				case "user_prompt": {
					const agentId = getActiveAgentId();
					if (!agentId) {
						return;
					}

					useChatStore.getState().pushMessage(getCurrentSessionKey(agentId), {
						kind: "chat",
						role: "user",
						content: formatObservedPrompt(event),
						images: event.images,
						replyContext: event.replyContext,
					});
					return;
				}
				case "thinking": {
					const agentId = getActiveAgentId();
					if (!agentId) {
						return;
					}
					useChatStore
						.getState()
						.appendThinking(getCurrentSessionKey(agentId), event.text);
					return;
				}
				case "text": {
					const agentId = getActiveAgentId();
					if (!agentId) {
						return;
					}
					useChatStore
						.getState()
						.appendText(getCurrentSessionKey(agentId), event.text);
					return;
				}
				case "image": {
					const agentId = getActiveAgentId();
					if (!agentId) {
						return;
					}
					useChatStore.getState().appendImage(getCurrentSessionKey(agentId), {
						path: event.path,
					});
					return;
				}
				case "compacting_started": {
					const agentId = getActiveAgentId();
					if (!agentId) {
						return;
					}
					useChatStore
						.getState()
						.setCompacting(getCurrentSessionKey(agentId), true);
					return;
				}
				case "compacting_finished": {
					const agentId = getActiveAgentId();
					if (!agentId) {
						return;
					}
					useChatStore
						.getState()
						.setCompacting(getCurrentSessionKey(agentId), false);
					return;
				}
				case "done": {
					const agentId = getActiveAgentId();
					if (!agentId) {
						return;
					}

					const currentSessionKey = getCurrentSessionKey(agentId);
					const providerId = useRuntimeStore.getState().providerId;
					if (!providerId) {
						return;
					}
					const nextSessionRef = createBrowserSessionRef(
						agentId,
						providerId,
						event.sessionId,
					);
					const nextSessionKey = createSessionKey(nextSessionRef);

					if (currentSessionKey !== nextSessionKey) {
						useChatStore
							.getState()
							.adoptSession(currentSessionKey, nextSessionKey);
					}
					useChatStore.getState().finalizeMessage(nextSessionKey);
					useSessionsStore.getState().setActiveSession(agentId, nextSessionRef);
					if (event.usage) {
						useContextUsageStore
							.getState()
							.setUsage(nextSessionKey, event.usage);
					}
					refreshSidebar();
					return;
				}
				case "model_changed":
					useRuntimeStore.getState().setModel(event.model);
					return;
				case "effort_changed":
					useRuntimeStore.getState().setEffort(event.effort);
					return;
				case "error": {
					const agentId = getActiveAgentId();
					if (agentId) {
						useChatStore
							.getState()
							.setError(getCurrentSessionKey(agentId), event.message);
					}
					useRuntimeStore.getState().setError(event.message);
					return;
				}
				case "skills_update":
					useSlashCommandsStore.getState().setSkills(event.skills);
					return;
				case "status":
					useRuntimePopupStore.getState().openStatus(event.message);
					return;
				case "cron_result":
					return;
				case "session_info":
					useRuntimePopupStore
						.getState()
						.openStatus(formatSessionInfoSummary(event));
					return;
				case "ask_response":
				case "ask_error":
					return;
			}
		},
		[refreshSidebar],
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
