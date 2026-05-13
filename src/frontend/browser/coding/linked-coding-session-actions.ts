import type { BrowserCodingSessionSummary } from "../../../common/protocol.ts";
import { fetchChatCodingSessions } from "../lib/api.ts";
import { useAgentsStore } from "../stores/agents.ts";
import { useRuntimePopupStore } from "../stores/runtime-popup.ts";
import { useSessionsStore } from "../stores/sessions.ts";
import { makeCodingSessionCenterTab } from "../stores/tab-policy.ts";
import { useTabsStore } from "../stores/tabs.ts";

const EMPTY_LINKED_CODING_MESSAGE = "No linked coding sessions for this chat.";
const LINKED_CODING_LOOKUP_ERROR = "Unable to open linked coding session";

interface LinkedCodingSessionLookupOptions {
	showEmptyStatus?: boolean;
	showLookupErrorStatus?: boolean;
}

export async function openLatestLinkedCodingSessionForActiveChat(
	options: { activate?: boolean; showEmptyStatus?: boolean } = {},
): Promise<boolean> {
	const sessions = await listLinkedCodingSessionsForActiveChat(options);
	const latest = sessions[0];
	if (!latest) {
		return false;
	}

	return openLinkedCodingSession(latest, options);
}

export async function listLinkedCodingSessionsForActiveChat(
	options: LinkedCodingSessionLookupOptions = {},
): Promise<BrowserCodingSessionSummary[]> {
	const activeAgentId = useAgentsStore.getState().activeAgentId;
	if (!activeAgentId) {
		if (options.showEmptyStatus ?? true) {
			useRuntimePopupStore.getState().openStatus(EMPTY_LINKED_CODING_MESSAGE);
		}
		return [];
	}
	const activeSession =
		useSessionsStore.getState().activeSessionByAgent[activeAgentId];
	if (!activeSession) {
		if (options.showEmptyStatus ?? true) {
			useRuntimePopupStore.getState().openStatus(EMPTY_LINKED_CODING_MESSAGE);
		}
		return [];
	}

	let response: Awaited<ReturnType<typeof fetchChatCodingSessions>>;
	try {
		response = await fetchChatCodingSessions({
			agentId: activeAgentId,
			providerId: activeSession.providerId,
			sdkSessionId: activeSession.sdkSessionId,
		});
	} catch (err) {
		if (options.showLookupErrorStatus ?? options.showEmptyStatus ?? true) {
			useRuntimePopupStore
				.getState()
				.openStatus(formatLinkedCodingLookupError(err));
		}
		return [];
	}

	const sessions = response.sessions.filter(
		(session) => session.lifecycleStatus === "open",
	);
	if (sessions.length === 0 && (options.showEmptyStatus ?? true)) {
		useRuntimePopupStore.getState().openStatus(EMPTY_LINKED_CODING_MESSAGE);
	}
	return sessions;
}

export function openLinkedCodingSession(
	session: BrowserCodingSessionSummary,
	options: { activate?: boolean; showEmptyStatus?: boolean } = {},
): boolean {
	const tab = makeCodingSessionCenterTab(session);
	if (!tab) {
		if (options.showEmptyStatus ?? true) {
			useRuntimePopupStore.getState().openStatus(EMPTY_LINKED_CODING_MESSAGE);
		}
		return false;
	}

	useTabsStore.getState().openTab(tab, { activate: options.activate ?? true });
	return true;
}

function formatLinkedCodingLookupError(err: unknown): string {
	const message = err instanceof Error ? err.message : String(err);
	return message
		? `${LINKED_CODING_LOOKUP_ERROR}: ${message}`
		: LINKED_CODING_LOOKUP_ERROR;
}
