import type { SessionCursor } from "../../common/protocol.ts";
import type { SessionRow } from "./session-store/session-store-records.ts";

export function addSessionCursorCondition(
	conditions: string[],
	params: Record<string, string | number>,
	cursor: SessionCursor | undefined,
	columns: {
		lastActive: string;
		providerId: string;
		sdkSessionId: string;
	} = {
		lastActive: "last_active",
		providerId: "provider_id",
		sdkSessionId: "sdk_session_id",
	},
) {
	if (!cursor) {
		return;
	}

	if (cursor.providerId) {
		conditions.push(
			`(
				${columns.lastActive} < $cursorLastActive
				OR (
					${columns.lastActive} = $cursorLastActive
					AND (
						${columns.providerId} > $cursorProviderId
						OR (
							${columns.providerId} = $cursorProviderId
							AND ${columns.sdkSessionId} > $cursorSessionId
						)
					)
				)
			)`,
		);
		params.$cursorProviderId = cursor.providerId;
	} else {
		conditions.push(
			`(
				${columns.lastActive} < $cursorLastActive
				OR (
					${columns.lastActive} = $cursorLastActive
					AND ${columns.sdkSessionId} > $cursorSessionId
				)
			)`,
		);
	}
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
		providerId: lastSession.providerId,
		sdkSessionId: lastSession.sdkSessionId,
	};
}
