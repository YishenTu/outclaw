import type { ServerEvent } from "../../../common/protocol.ts";
import type { SessionMenuData } from "./types.ts";

export function applySessionEventToMenuData(
	menuData: SessionMenuData | null,
	event: ServerEvent,
): SessionMenuData | null {
	if (!menuData) {
		if (event.type === "session_list") {
			return {
				activeSessionId: event.activeSessionId,
				nextCursor: event.nextCursor,
				searchQuery: undefined,
				sessions: event.sessions,
			};
		}
		if (event.type === "session_search_result") {
			return {
				nextCursor: event.nextCursor,
				searchQuery: event.query,
				sessions: event.sessions,
			};
		}
		return null;
	}

	switch (event.type) {
		case "session_cleared":
			return { ...menuData, activeSessionId: undefined };
		case "session_switched":
			return { ...menuData, activeSessionId: event.sdkSessionId };
		case "session_list":
			return {
				...menuData,
				activeSessionId: event.activeSessionId ?? menuData.activeSessionId,
				nextCursor: event.nextCursor,
				searchQuery: undefined,
				sessions: menuData.searchQuery
					? event.sessions
					: mergeSessionSummaries(menuData.sessions, event.sessions),
			};
		case "session_search_result":
			return {
				...menuData,
				nextCursor: event.nextCursor,
				searchQuery: event.query,
				sessions:
					menuData.searchQuery === event.query
						? mergeSessionSummaries(menuData.sessions, event.sessions)
						: event.sessions,
			};
		case "session_renamed":
			return {
				...menuData,
				sessions: menuData.sessions.map((session) =>
					session.sdkSessionId === event.sdkSessionId
						? { ...session, title: event.title }
						: session,
				),
			};
		case "session_deleted":
			return {
				...menuData,
				activeSessionId:
					menuData.activeSessionId === event.sdkSessionId
						? undefined
						: menuData.activeSessionId,
				sessions: menuData.sessions.filter(
					(session) => session.sdkSessionId !== event.sdkSessionId,
				),
			};
		default:
			return menuData;
	}
}

function mergeSessionSummaries(
	current: SessionMenuData["sessions"],
	incoming: SessionMenuData["sessions"],
): SessionMenuData["sessions"] {
	const merged = [...current];
	const seen = new Set(current.map((session) => session.sdkSessionId));
	for (const session of incoming) {
		if (seen.has(session.sdkSessionId)) {
			continue;
		}
		merged.push(session);
		seen.add(session.sdkSessionId);
	}
	return merged;
}

export function shouldEnableGlobalStopShortcut(
	running: boolean,
	menuVisible: boolean,
): boolean {
	return running && !menuVisible;
}
