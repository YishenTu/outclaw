import type {
	BrowserAgentsResponse,
	ImageRef,
	ServerEvent,
} from "../../common/protocol.ts";
import { formatStatusCompact } from "../../common/status.ts";
import { applyBrowserStatusEvent } from "./browser-status-event.ts";
import { ensureRunningChatSession } from "./ensure-running-chat-session.ts";
import { toObservedDisplayMessage } from "./observed-prompt.ts";
import { createBrowserSessionRef, createSessionKey } from "./session.ts";
import { useAgentsStore } from "./stores/agents.ts";
import { useChatStore } from "./stores/chat.ts";
import { useContextUsageStore } from "./stores/context-usage.ts";
import { useRightPanelRefreshStore } from "./stores/right-panel-refresh.ts";
import { useRuntimeStore } from "./stores/runtime.ts";
import { useRuntimePopupStore } from "./stores/runtime-popup.ts";
import { type SessionEntry, useSessionsStore } from "./stores/sessions.ts";
import { useSlashCommandsStore } from "./stores/slash-commands.ts";

type SessionKey = string;

export function applySidebarSummary(summary: BrowserAgentsResponse) {
	useAgentsStore.getState().setAgents(
		summary.agents.map((agent) => ({
			agentId: agent.agentId,
			name: agent.name,
			terminalRunCommand:
				typeof agent.terminalRunCommand === "string"
					? agent.terminalRunCommand
					: "",
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

export function formatSessionListSummary(
	event: Extract<ServerEvent, { type: "session_list" }>,
): string {
	if (event.sessions.length === 0) {
		return "Sessions\nnone";
	}

	return `Sessions\n${event.sessions
		.map((session) => `${session.title}  ${session.model}`)
		.join("\n")}`;
}

export function formatSessionInfoSummary(
	event: Extract<ServerEvent, { type: "session_info" }>,
): string {
	return `Session\n${event.title}\nmodel: ${event.model}\nid: ${event.sdkSessionId}`;
}

export function inferImageMediaTypeFromPath(
	path: string,
): ImageRef["mediaType"] | undefined {
	const lowerPath = path.toLowerCase();
	if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) {
		return "image/jpeg";
	}
	if (lowerPath.endsWith(".png")) {
		return "image/png";
	}
	if (lowerPath.endsWith(".gif")) {
		return "image/gif";
	}
	if (lowerPath.endsWith(".webp")) {
		return "image/webp";
	}
	return undefined;
}

interface LiveRunCompletion {
	adoptFromSessionKey?: SessionKey;
	sessionKey: SessionKey;
}

interface BrowserServerEventHandlerOptions {
	clearLiveRunSessions: () => void;
	completeLiveRunSession: (
		nextSessionKey: SessionKey,
		currentSessionKey: SessionKey,
	) => LiveRunCompletion;
	getActiveAgentId: () => string | null;
	getCurrentSessionKey: (agentId: string) => SessionKey;
	invalidateSidebarRefresh: () => void;
	pinObservedSessionKey: (
		agentId: string,
		observedSessionId?: string,
	) => SessionKey;
	refreshSidebar: () => void;
	routeObservedSessionKey: (
		agentId: string,
		observedSessionId?: string,
	) => SessionKey;
}

export function handleBrowserServerEvent(
	event: ServerEvent,
	options: BrowserServerEventHandlerOptions,
) {
	switch (event.type) {
		case "agent_menu":
			useRuntimePopupStore.getState().openAgentMenu(event);
			return;
		case "agent_switched": {
			useRuntimePopupStore.getState().closePopup();
			useAgentsStore.getState().setActiveAgent(event.agentId);
			useRuntimeStore.getState().setAgentName(event.name);
			useRuntimeStore.getState().clearSession();
			options.refreshSidebar();
			return;
		}
		case "runtime_status": {
			useRuntimeStore.getState().updateFromStatus(event);
			if (event.requested) {
				useRuntimePopupStore.getState().openStatus(formatStatusCompact(event));
			}
			const agentId = options.getActiveAgentId();
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
			if (event.running) {
				ensureRunningChatSession(
					agentId,
					event.providerId ?? useRuntimeStore.getState().providerId,
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
			const agentId = options.getActiveAgentId();
			const providerId = useRuntimeStore.getState().providerId;
			if (!agentId) {
				return;
			}
			useSessionsStore
				.getState()
				.setActiveSession(
					agentId,
					providerId
						? createBrowserSessionRef(agentId, providerId, event.sdkSessionId)
						: null,
				);
			options.refreshSidebar();
			return;
		}
		case "session_renamed": {
			useRuntimePopupStore.getState().closePopup();
			options.refreshSidebar();
			return;
		}
		case "session_deleted": {
			useRuntimePopupStore.getState().closePopup();
			useSessionsStore.getState().deleteSessionBySdkId(event.sdkSessionId);
			options.refreshSidebar();
			return;
		}
		case "session_cleared": {
			useRuntimePopupStore.getState().closePopup();
			const agentId = options.getActiveAgentId();
			if (!agentId) {
				return;
			}
			options.invalidateSidebarRefresh();
			options.clearLiveRunSessions();
			const sessionKey = options.getCurrentSessionKey(agentId);
			useSessionsStore.getState().setActiveSession(agentId, null);
			useChatStore.getState().clearSession(sessionKey);
			useChatStore.getState().clearPendingSessions(agentId);
			useRuntimeStore.getState().clearSession();
			return;
		}
		case "history_replay": {
			const agentId = options.getActiveAgentId();
			const runtime = useRuntimeStore.getState();
			const providerId = runtime.providerId;
			if (!agentId) {
				return;
			}
			if (!providerId) {
				return;
			}

			useChatStore
				.getState()
				.replaceHistory(
					createSessionKey(
						createBrowserSessionRef(agentId, providerId, event.sdkSessionId),
					),
					event.messages,
					{
						preservePendingTurn:
							runtime.running &&
							runtime.sessionId === event.sdkSessionId &&
							runtime.providerId === providerId,
					},
				);
			if (runtime.running) {
				ensureRunningChatSession(agentId, runtime.providerId);
			}
			return;
		}
		case "streaming_sync": {
			const agentId = options.getActiveAgentId();
			const providerId = useRuntimeStore.getState().providerId;
			if (!agentId || !providerId) {
				return;
			}

			const sessionKey = createSessionKey(
				createBrowserSessionRef(agentId, providerId, event.sdkSessionId),
			);
			useChatStore.getState().restoreStreamingState(sessionKey, {
				images: event.images,
				text: event.text,
				thinking: event.thinking,
			});
			return;
		}
		case "user_prompt": {
			const agentId = options.getActiveAgentId();
			if (!agentId) {
				return;
			}
			const sessionKey = options.pinObservedSessionKey(
				agentId,
				event.sessionId,
			);
			const message = toObservedDisplayMessage(event);
			if (!message) {
				return;
			}

			useChatStore.getState().pushMessage(
				sessionKey,
				message.kind === "chat"
					? {
							...message,
							timestamp: Date.now(),
						}
					: message,
			);
			return;
		}
		case "thinking": {
			const agentId = options.getActiveAgentId();
			if (!agentId) {
				return;
			}
			useChatStore
				.getState()
				.appendThinking(
					options.routeObservedSessionKey(agentId, event.sessionId),
					event.text,
				);
			return;
		}
		case "text": {
			const agentId = options.getActiveAgentId();
			if (!agentId) {
				return;
			}
			useChatStore
				.getState()
				.appendText(
					options.routeObservedSessionKey(agentId, event.sessionId),
					event.text,
				);
			return;
		}
		case "image": {
			const agentId = options.getActiveAgentId();
			if (!agentId) {
				return;
			}
			useChatStore
				.getState()
				.appendImage(
					options.routeObservedSessionKey(agentId, event.sessionId),
					{
						kind: "managed",
						path: event.path,
						mediaType:
							event.mediaType ??
							inferImageMediaTypeFromPath(event.path) ??
							"image/png",
					},
				);
			return;
		}
		case "compacting_started": {
			const agentId = options.getActiveAgentId();
			if (!agentId) {
				return;
			}
			useChatStore
				.getState()
				.setCompacting(
					options.routeObservedSessionKey(agentId, event.sessionId),
					true,
				);
			return;
		}
		case "compacting_finished": {
			const agentId = options.getActiveAgentId();
			if (!agentId) {
				return;
			}
			useChatStore
				.getState()
				.setCompacting(
					options.routeObservedSessionKey(agentId, event.sessionId),
					false,
				);
			return;
		}
		case "done": {
			const agentId = options.getActiveAgentId();
			if (!agentId) {
				return;
			}

			const currentSessionKey = options.getCurrentSessionKey(agentId);
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
			const completion = options.completeLiveRunSession(
				nextSessionKey,
				currentSessionKey,
			);

			if (
				completion.adoptFromSessionKey &&
				completion.adoptFromSessionKey !== completion.sessionKey
			) {
				useChatStore
					.getState()
					.adoptSession(completion.adoptFromSessionKey, completion.sessionKey);
			}
			useChatStore.getState().finalizeMessage(completion.sessionKey, {
				timestamp: Date.now(),
			});
			useSessionsStore.getState().setActiveSession(agentId, nextSessionRef);
			if (event.usage) {
				useContextUsageStore.getState().setUsage(nextSessionKey, event.usage);
			}
			options.refreshSidebar();
			return;
		}
		case "model_changed":
			useRuntimeStore.getState().setModel(event.model);
			return;
		case "effort_changed":
			useRuntimeStore.getState().setEffort(event.effort);
			return;
		case "error": {
			const agentId = options.getActiveAgentId();
			if (agentId) {
				const sessionKey = options.routeObservedSessionKey(
					agentId,
					event.sessionId,
				);
				useChatStore.getState().setError(sessionKey, event.message);
			}
			options.clearLiveRunSessions();
			useRuntimeStore.getState().setError(event.message);
			return;
		}
		case "skills_update":
			useSlashCommandsStore.getState().setSkills(event.skills);
			return;
		case "status":
			applyBrowserStatusEvent({
				activeAgentId: options.getActiveAgentId(),
				closePopup: useRuntimePopupStore.getState().closePopup,
				event,
				finalizeMessage: (sessionKey, options) => {
					useChatStore.getState().finalizeMessage(sessionKey, options);
				},
				openStatus: useRuntimePopupStore.getState().openStatus,
				pushMessage: (sessionKey, message) => {
					useChatStore.getState().pushMessage(sessionKey, message);
				},
				resolveCurrentSessionKey: options.getCurrentSessionKey,
			});
			return;
		case "browser_sidebar_invalidated":
			useRightPanelRefreshStore.getState().invalidate(event);
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
}
