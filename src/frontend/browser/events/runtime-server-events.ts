import type {
	BrowserAgentsResponse,
	ServerEvent,
} from "../../../common/protocol.ts";
import { formatStatusCompact } from "../../../common/status.ts";
import {
	createBrowserSessionRef,
	createSessionKey,
} from "../sessions/session.ts";
import { useAgentsStore } from "../stores/agents.ts";
import { useChatStore } from "../stores/chat.ts";
import { useContextUsageStore } from "../stores/context-usage.ts";
import { useRightPanelRefreshStore } from "../stores/right-panel-refresh.ts";
import { useRuntimeStore } from "../stores/runtime.ts";
import { useRuntimePopupStore } from "../stores/runtime-popup.ts";
import { type SessionEntry, useSessionsStore } from "../stores/sessions.ts";
import { useSlashCommandsStore } from "../stores/slash-commands.ts";
import {
	applyBrowserChatEvent,
	type BrowserChatEventHandlerOptions,
	inferImageMediaTypeFromPath,
} from "./browser-chat-events.ts";
import { applyBrowserStatusEvent } from "./browser-status-event.ts";
import { ensureRunningChatSession } from "./ensure-running-chat-session.ts";

export { inferImageMediaTypeFromPath };

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

interface BrowserServerEventHandlerOptions
	extends BrowserChatEventHandlerOptions {
	invalidateSidebarRefresh: () => void;
}

export function handleBrowserServerEvent(
	event: ServerEvent,
	options: BrowserServerEventHandlerOptions,
) {
	if (applyBrowserChatEvent(event, options)) {
		return;
	}

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
		case "model_changed":
			useRuntimeStore.getState().setModel(event.model);
			return;
		case "effort_changed":
			useRuntimeStore.getState().setEffort(event.effort);
			return;
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
