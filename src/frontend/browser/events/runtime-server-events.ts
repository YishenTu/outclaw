import type {
	BrowserAgentsResponse,
	ServerEvent,
} from "../../../common/protocol.ts";
import { formatStatusCompact } from "../../../common/status.ts";
import {
	createBrowserSessionRef,
	createSessionKey,
} from "../sessions/session.ts";
import { useAgentFilesStore } from "../stores/agent-files.ts";
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

	const runtime = useRuntimeStore.getState();

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
			agent.nextSessionCursor,
		);
		const currentActiveSession =
			useSessionsStore.getState().activeSessionByAgent[agent.agentId];
		useSessionsStore.getState().setActiveSession(
			agent.agentId,
			resolveSidebarActiveSession({
				agent,
				currentActiveSession,
				runtime,
			}),
		);
	}
}

function resolveSidebarActiveSession(params: {
	agent: BrowserAgentsResponse["agents"][number];
	currentActiveSession:
		| ReturnType<typeof createBrowserSessionRef>
		| null
		| undefined;
	runtime: ReturnType<typeof useRuntimeStore.getState>;
}) {
	if (
		params.agent.name === params.runtime.agentName &&
		params.runtime.running
	) {
		if (params.runtime.providerId && params.runtime.sessionId) {
			return createBrowserSessionRef(
				params.agent.agentId,
				params.runtime.providerId,
				params.runtime.sessionId,
			);
		}
		return params.currentActiveSession ?? null;
	}

	return params.agent.activeSession
		? createBrowserSessionRef(
				params.agent.agentId,
				params.agent.activeSession.providerId,
				params.agent.activeSession.sdkSessionId,
			)
		: null;
}

export function formatSessionListSummary(
	event: Extract<ServerEvent, { type: "session_list" }>,
): string {
	return formatSessionSummary("Sessions", event.sessions);
}

export function formatSessionSearchSummary(
	event: Extract<ServerEvent, { type: "session_search_result" }>,
): string {
	return formatSessionSummary(
		`Session search "${event.query}"`,
		event.sessions,
	);
}

function formatSessionSummary(
	header: string,
	sessions: ReadonlyArray<{ title: string; model: string }>,
): string {
	if (sessions.length === 0) {
		return `${header}\nnone`;
	}
	return `${header}\n${sessions
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
	bindLiveRunSession: (
		nextSessionKey: string,
		currentSessionKey: string,
	) => ReturnType<BrowserChatEventHandlerOptions["completeLiveRunSession"]>;
	invalidateSidebarRefresh: () => void;
	/**
	 * Targeted refresh of slash commands / skills for the agent this client is
	 * currently bound to. Used on agent_switched to update the command palette
	 * without re-fetching every agent's session list (which would otherwise
	 * trample any "Load more" pagination state — see the load-more flicker fix).
	 */
	requestSkills: () => void;
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
			// The sidebar's per-agent session lists do not change as a function of
			// which agent THIS client is bound to — they're fetched globally and
			// kept fresh by browser_agents_invalidated pushes from the server. A
			// full refreshSidebar() here would replace each agent's session list
			// with a fresh first-page-only response, trampling any "Load more"
			// pagination state and causing the load-more button to briefly flicker
			// back into view (then disappear once auto-pagination re-fetches the
			// next page). Skills, however, ARE per-agent and need a targeted refresh.
			options.requestSkills();
			return;
		}
		case "runtime_status": {
			const agentId = options.getActiveAgentId();
			const providerId =
				event.providerId ?? useRuntimeStore.getState().providerId;
			const currentSessionKey =
				agentId && event.running && event.sessionId && providerId
					? options.getCurrentSessionKey(agentId)
					: undefined;
			useRuntimeStore.getState().updateFromStatus(event);
			if (event.requested) {
				useRuntimePopupStore.getState().openStatus(formatStatusCompact(event));
			}
			if (!agentId) {
				return;
			}

			if (event.sessionId && providerId) {
				const sessionRef = createBrowserSessionRef(
					agentId,
					providerId,
					event.sessionId,
				);
				const sessionKey = createSessionKey(sessionRef);

				if (event.running && currentSessionKey) {
					const binding = options.bindLiveRunSession(
						sessionKey,
						currentSessionKey,
					);
					if (
						binding.adoptFromSessionKey &&
						binding.adoptFromSessionKey !== binding.sessionKey
					) {
						useChatStore
							.getState()
							.adoptSession(binding.adoptFromSessionKey, binding.sessionKey);
					}
				}

				useSessionsStore.getState().setActiveSession(agentId, sessionRef);
				if (event.usage) {
					useContextUsageStore.getState().setUsage(sessionKey, event.usage);
				}
			} else if (!event.running) {
				useSessionsStore.getState().setActiveSession(agentId, null);
			}

			if (event.running) {
				ensureRunningChatSession(agentId, providerId);
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
		case "session_search_result":
			useRuntimePopupStore
				.getState()
				.openStatus(formatSessionSearchSummary(event));
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
			// session_switched is a pure active-session indicator change; the agent's
			// session list itself is unchanged. setActiveSession above is sufficient.
			// Do NOT refreshSidebar here — it would replace-write first-page data
			// over any existing pagination, flickering the load-more button.
			return;
		}
		case "session_renamed": {
			const agentId = options.getActiveAgentId();
			const runtime = useRuntimeStore.getState();
			const providerId = event.providerId ?? runtime.providerId;
			if (!agentId || !providerId) {
				return;
			}
			const sessionRef = createBrowserSessionRef(
				agentId,
				providerId,
				event.sdkSessionId,
			);
			const activeSession =
				useSessionsStore.getState().activeSessionByAgent[agentId] ?? null;
			useSessionsStore.getState().renameSession(sessionRef, event.title);

			const matchesActiveSession =
				activeSession?.providerId === providerId &&
				activeSession.sdkSessionId === event.sdkSessionId;
			const matchesRuntimeSession =
				runtime.providerId === providerId &&
				runtime.sessionId === event.sdkSessionId;
			if (matchesActiveSession || matchesRuntimeSession) {
				useRuntimeStore.getState().setSessionTitle(event.title);
			}
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
			if (event.agentId && event.sections.includes("tree")) {
				useAgentFilesStore.getState().invalidate(event.agentId);
			}
			return;
		case "browser_agents_invalidated":
			options.refreshSidebar();
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
		case "send_response":
		case "send_error":
			return;
	}
}
