import type { ServerEvent } from "../../common/protocol.ts";

export interface TuiEventUpdate {
	append?: string;
	replace?: string;
	running?: boolean;
}

function formatContext(
	usage:
		| {
				contextTokens: number;
				contextWindow: number;
				percentage: number;
		  }
		| undefined,
): string {
	if (!usage) {
		return "n/a";
	}

	return `${usage.contextTokens.toLocaleString()}/${usage.contextWindow.toLocaleString()} tokens (${usage.percentage}%)`;
}

export function getTuiEventUpdate(
	event: ServerEvent,
): TuiEventUpdate | undefined {
	switch (event.type) {
		case "session_cleared":
		case "session_switched":
			return { replace: "" };
		case "history_replay":
			return {
				replace: event.messages
					.map((message) =>
						message.role === "user"
							? `> ${message.content}\n`
							: `${message.content}\n`,
					)
					.join("\n"),
			};
		case "model_changed":
			return { append: `[model] ${event.model}\n` };
		case "runtime_status":
			return {
				append: `[status] model=${event.model} effort=${event.effort} session=${event.sessionId ?? "none"} context=${formatContext(
					event.usage,
				)}\n`,
			};
		case "status":
			return { append: `[status] ${event.message}\n` };
		case "effort_changed":
			return { append: `[effort] ${event.effort}\n` };
		case "user_prompt":
			return { append: `[${event.source}] ${event.prompt}\n` };
		case "text":
			return { append: event.text };
		case "error":
			return {
				append: `\n[error] ${event.message}`,
				running: false,
			};
		case "done":
			return {
				append: "\n",
				running: false,
			};
	}
}
