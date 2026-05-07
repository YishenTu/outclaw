import type { SessionCursor } from "../../common/protocol.ts";
import type { SessionRow } from "./session-store/session-store-records.ts";

export function addSessionCursorCondition(
	conditions: string[],
	params: Record<string, string | number>,
	cursor: SessionCursor | undefined,
) {
	if (!cursor) {
		return;
	}

	conditions.push(
		`(
			last_active < $cursorLastActive
			OR (
				last_active = $cursorLastActive
				AND sdk_session_id > $cursorSessionId
			)
		)`,
	);
	params.$cursorLastActive = cursor.lastActive;
	params.$cursorSessionId = cursor.sdkSessionId;
}

export function nextSessionCursor(
	sessions: SessionRow[],
	limit: number,
): SessionCursor | undefined {
	if (sessions.length !== limit || sessions.length === 0) {
		return undefined;
	}

	const lastSession = sessions[sessions.length - 1];
	if (!lastSession) {
		return undefined;
	}

	return {
		lastActive: lastSession.lastActive,
		sdkSessionId: lastSession.sdkSessionId,
	};
}
