import type { ServerEvent } from "../../../common/protocol.ts";
import { formatContext, formatLivePrompt } from "./format.ts";
import type { TuiAction } from "./reducer.ts";
import type { TuiMessage } from "./state.ts";

export function mapEventToActions(event: ServerEvent): TuiAction[] {
	switch (event.type) {
		case "text":
			return [{ type: "append_streaming", text: event.text }];
		case "done":
			return [{ type: "commit_streaming" }];
		case "error":
			return [{ type: "push_and_stop", role: "error", text: event.message }];
		case "status":
			return [{ type: "push", role: "info", text: event.message }];
		case "model_changed":
			return [{ type: "push", role: "info", text: `model → ${event.model}` }];
		case "effort_changed":
			return [{ type: "push", role: "info", text: `effort → ${event.effort}` }];
		case "runtime_status":
			return [
				{
					type: "push",
					role: "info",
					text: `model=${event.model} effort=${event.effort} session=${event.sessionId ?? "none"} context=${formatContext(event.usage)}`,
				},
			];
		case "user_prompt":
			if (event.source === "tui") {
				return [{ type: "noop" }];
			}
			return [
				{
					type: "push",
					role: "user",
					text: formatLivePrompt(
						event.source,
						event.prompt,
						event.images,
					).trimEnd(),
				},
			];
		case "image":
			return [{ type: "push", role: "info", text: `image: ${event.path}` }];
		case "cron_result":
			return [
				{
					type: "push",
					role: "info",
					text: `[cron] ${event.jobName}`,
				},
				{
					type: "push",
					role: "assistant",
					text: event.text,
				},
			];
		case "session_cleared":
		case "session_switched":
			return [{ type: "clear" }];
		case "history_replay": {
			let id = 1;
			const messages: TuiMessage[] = event.messages.map((message) => ({
				id: id++,
				role: message.role,
				text: replayContent(message),
			}));
			return [{ type: "replay", messages }];
		}
		case "session_menu":
			return [
				{
					type: "session_menu",
					data: {
						activeSessionId: event.activeSessionId,
						sessions: event.sessions,
					},
				},
			];
		case "session_renamed":
		case "session_deleted":
		case "session_info":
		case "session_list":
			return [{ type: "noop" }];
	}
}

function replayContent(message: {
	role: string;
	content: string;
	images?: Array<{ path?: string; mediaType?: string }>;
}): string {
	if (message.role === "assistant") {
		return message.content;
	}

	const parts: string[] = [];
	if (message.content) {
		parts.push(message.content);
	}
	for (const image of message.images ?? []) {
		parts.push(image.path ? `[image: ${image.path}]` : "[image]");
	}
	return parts.join("\n");
}
