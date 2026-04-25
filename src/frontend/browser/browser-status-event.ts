import type {
	DisplayStatusMessage,
	StatusEvent,
} from "../../common/protocol.ts";

interface ApplyBrowserStatusEventParams {
	activeAgentId: string | null;
	closePopup: () => void;
	event: StatusEvent;
	finalizeMessage: (
		sessionKey: string,
		options?: { timestamp?: number },
	) => void;
	now?: () => number;
	openStatus: (message: string) => void;
	pushMessage: (sessionKey: string, message: DisplayStatusMessage) => void;
	resolveCurrentSessionKey: (agentId: string) => string;
}

export function applyBrowserStatusEvent({
	activeAgentId,
	closePopup,
	event,
	finalizeMessage,
	now = Date.now,
	openStatus,
	pushMessage,
	resolveCurrentSessionKey,
}: ApplyBrowserStatusEventParams): void {
	if (event.presentation !== "inline" || !activeAgentId) {
		openStatus(event.message);
		return;
	}

	const timestamp = now();
	const sessionKey = resolveCurrentSessionKey(activeAgentId);
	closePopup();
	finalizeMessage(sessionKey, { timestamp });
	pushMessage(sessionKey, {
		kind: "system",
		event: "status",
		text: event.message,
		timestamp,
	});
}
