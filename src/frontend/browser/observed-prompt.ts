import { HEARTBEAT_DISPLAY_LABEL } from "../../common/heartbeat-prompt.ts";
import type { DisplayMessage, ServerEvent } from "../../common/protocol.ts";
import { ROLLOVER_DISPLAY_LABEL } from "../../common/rollover-prompt.ts";

export function toObservedDisplayMessage(
	event: Extract<ServerEvent, { type: "user_prompt" }>,
): DisplayMessage {
	if (event.source === "heartbeat") {
		return {
			kind: "system",
			event: "heartbeat",
			text: HEARTBEAT_DISPLAY_LABEL,
		};
	}
	if (event.source === "rollover") {
		return {
			kind: "system",
			event: "rollover",
			text: ROLLOVER_DISPLAY_LABEL,
		};
	}

	return {
		kind: "chat",
		role: "user",
		content: formatObservedPrompt(event),
		images: event.images,
		replyContext: event.replyContext,
	};
}

function formatObservedPrompt(
	event: Extract<ServerEvent, { type: "user_prompt" }>,
): string {
	if (event.source === "telegram") {
		return event.prompt ? `[telegram]\n${event.prompt}` : "[telegram]";
	}

	return event.prompt;
}
