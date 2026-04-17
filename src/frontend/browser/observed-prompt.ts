import type { ServerEvent } from "../../common/protocol.ts";

export function formatObservedPrompt(
	event: Extract<ServerEvent, { type: "user_prompt" }>,
) {
	if (event.source === "telegram") {
		return event.prompt ? `[telegram]\n${event.prompt}` : "[telegram]";
	}

	if (event.source === "heartbeat") {
		return event.prompt ? `[heartbeat]\n${event.prompt}` : "[heartbeat]";
	}

	return event.prompt;
}
