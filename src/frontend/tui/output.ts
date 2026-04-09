import type {
	DisplayImage,
	DisplayMessage,
	ServerEvent,
} from "../../common/protocol.ts";

export interface SessionMenuData {
	activeSessionId?: string;
	sessions: Array<{
		sdkSessionId: string;
		title: string;
		model: string;
		lastActive: number;
	}>;
}

export interface TuiEventUpdate {
	append?: string;
	replace?: string;
	running?: boolean;
	sessionMenu?: SessionMenuData;
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
		case "session_menu":
			return {
				sessionMenu: {
					activeSessionId: event.activeSessionId,
					sessions: event.sessions,
				},
			};
		case "session_cleared":
		case "session_switched":
			return { replace: "" };
		case "session_renamed":
		case "session_deleted":
			return {};
		case "history_replay":
			return {
				replace: event.messages.map(formatReplayMessage).join("\n"),
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
			return {
				append: formatLivePrompt(event.source, event.prompt, event.images),
			};
		case "text":
			return { append: event.text };
		case "image":
			return { append: `[image: ${event.path}]\n` };
		case "cron_result":
			return {
				append: `[cron] ${event.jobName}\n${event.text}\n`,
			};
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

function formatImage(image: DisplayImage): string {
	return image.path ? `[image: ${image.path}]` : "[image]";
}

function formatLivePrompt(
	source: string,
	prompt: string,
	images?: DisplayImage[],
): string {
	const lines: string[] = [];
	const prefix = `[${source}] `;

	if (prompt) {
		lines.push(`${prefix}${prompt}`);
	}

	for (const image of images ?? []) {
		lines.push(`${prefix}${formatImage(image)}`);
	}

	return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function formatReplayMessage(message: DisplayMessage): string {
	if (message.role === "assistant") {
		return `${message.content}\n`;
	}

	const lines: string[] = [];
	if (message.content) {
		lines.push(`> ${message.content}`);
	}

	for (const image of message.images ?? []) {
		lines.push(`> ${formatImage(image)}`);
	}

	return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}
