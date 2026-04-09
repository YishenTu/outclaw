import type { ServerEvent } from "../../common/protocol.ts";
import type { SessionMenuData } from "./messages.ts";

export function applySessionEventToMenuData(
	menuData: SessionMenuData | null,
	event: ServerEvent,
): SessionMenuData | null {
	if (!menuData) {
		return null;
	}

	switch (event.type) {
		case "session_cleared":
			return { ...menuData, activeSessionId: undefined };
		case "session_switched":
			return { ...menuData, activeSessionId: event.sdkSessionId };
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

export function shouldEnableGlobalStopShortcut(
	running: boolean,
	menuVisible: boolean,
): boolean {
	return running && !menuVisible;
}
