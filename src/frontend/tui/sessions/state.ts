import type { ServerEvent } from "../../../common/protocol.ts";
import type { SessionMenuData } from "./types.ts";

export function applySessionEventToMenuData(
	menuData: SessionMenuData | null,
	event: ServerEvent,
): SessionMenuData | null {
	if (!menuData) {
		if (event.type === "session_list") {
			return withOptionalActiveProvider(
				{
					activeSessionId: event.activeSessionId,
					nextCursor: event.nextCursor,
					searchQuery: undefined,
					sessions: event.sessions,
				},
				event.activeProviderId,
			);
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
		case "session_cleared": {
			const { activeProviderId: _activeProviderId, ...rest } = menuData;
			return { ...rest, activeSessionId: undefined };
		}
		case "session_switched":
			return withActiveSession(menuData, {
				providerId: event.providerId,
				sdkSessionId: event.sdkSessionId,
			});
		case "session_list":
			return withOptionalActiveProvider(
				{
					...menuData,
					activeSessionId: event.activeSessionId ?? menuData.activeSessionId,
					nextCursor: event.nextCursor,
					searchQuery: undefined,
					sessions: menuData.searchQuery
						? event.sessions
						: mergeSessionSummaries(menuData.sessions, event.sessions),
				},
				event.activeProviderId ??
					(event.activeSessionId === undefined ||
					event.activeSessionId === menuData.activeSessionId
						? menuData.activeProviderId
						: undefined),
			);
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
					sessionMatchesEvent(session, event)
						? { ...session, title: event.title }
						: session,
				),
			};
		case "session_deleted": {
			const deletedActive = activeSessionMatchesEvent(menuData, event);
			const next = {
				...menuData,
				activeSessionId: deletedActive ? undefined : menuData.activeSessionId,
				sessions: menuData.sessions.filter(
					(session) => !sessionMatchesEvent(session, event),
				),
			};
			if (!deletedActive) {
				return next;
			}
			const { activeProviderId: _activeProviderId, ...rest } = next;
			return rest;
		}
		default:
			return menuData;
	}
}

function withActiveSession(
	menuData: SessionMenuData,
	session: { providerId?: string; sdkSessionId: string },
): SessionMenuData {
	const next = {
		...menuData,
		activeSessionId: session.sdkSessionId,
	};
	if (session.providerId) {
		return {
			...next,
			activeProviderId: session.providerId,
		};
	}
	const { activeProviderId: _activeProviderId, ...rest } = next;
	return rest;
}

function withOptionalActiveProvider(
	menuData: SessionMenuData,
	providerId: string | undefined,
): SessionMenuData {
	if (providerId) {
		return {
			...menuData,
			activeProviderId: providerId,
		};
	}
	const { activeProviderId: _activeProviderId, ...rest } = menuData;
	return rest;
}

function activeSessionMatchesEvent(
	menuData: SessionMenuData,
	event: { providerId?: string; sdkSessionId: string },
): boolean {
	if (menuData.activeSessionId !== event.sdkSessionId) {
		return false;
	}
	if (!event.providerId || !menuData.activeProviderId) {
		return true;
	}
	return menuData.activeProviderId === event.providerId;
}

function sessionMatchesEvent(
	session: SessionMenuData["sessions"][number],
	event: { providerId?: string; sdkSessionId: string },
): boolean {
	if (session.sdkSessionId !== event.sdkSessionId) {
		return false;
	}
	if (!event.providerId || !session.providerId) {
		return true;
	}
	return session.providerId === event.providerId;
}

function mergeSessionSummaries(
	current: SessionMenuData["sessions"],
	incoming: SessionMenuData["sessions"],
): SessionMenuData["sessions"] {
	const merged = [...current];
	const seen = new Set(current.map(sessionKey));
	for (const session of incoming) {
		const key = sessionKey(session);
		if (seen.has(key)) {
			continue;
		}
		merged.push(session);
		seen.add(key);
	}
	return merged;
}

function sessionKey(session: SessionMenuData["sessions"][number]): string {
	return `${session.providerId ?? ""}\u0000${session.sdkSessionId}`;
}

export function shouldEnableGlobalStopShortcut(
	running: boolean,
	menuVisible: boolean,
): boolean {
	return running && !menuVisible;
}
