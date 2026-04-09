import type { ServerEvent } from "../../common/protocol.ts";
import { formatContext, formatLivePrompt } from "./format.ts";
import type {
	SessionMenuData,
	TuiMessage,
	TuiMessageRole,
	TuiState,
} from "./messages.ts";

export type TuiAction =
	| { type: "append_streaming"; text: string }
	| { type: "commit_streaming" }
	| { type: "push"; role: TuiMessageRole; text: string }
	| { type: "push_and_stop"; role: TuiMessageRole; text: string }
	| { type: "clear" }
	| { type: "replay"; messages: TuiMessage[] }
	| { type: "session_menu"; data: SessionMenuData }
	| { type: "noop" };

export function mapEventToAction(event: ServerEvent): TuiAction {
	switch (event.type) {
		case "text":
			return { type: "append_streaming", text: event.text };
		case "done":
			return { type: "commit_streaming" };
		case "error":
			return { type: "push_and_stop", role: "error", text: event.message };
		case "status":
			return { type: "push", role: "info", text: event.message };
		case "model_changed":
			return { type: "push", role: "info", text: `model → ${event.model}` };
		case "effort_changed":
			return { type: "push", role: "info", text: `effort → ${event.effort}` };
		case "runtime_status":
			return {
				type: "push",
				role: "info",
				text: `model=${event.model} effort=${event.effort} session=${event.sessionId ?? "none"} context=${formatContext(event.usage)}`,
			};
		case "user_prompt":
			if (event.source === "tui") return { type: "noop" };
			return {
				type: "push",
				role: "user",
				text: formatLivePrompt(
					event.source,
					event.prompt,
					event.images,
				).trimEnd(),
			};
		case "image":
			return { type: "push", role: "info", text: `image: ${event.path}` };
		case "cron_result":
			return {
				type: "push",
				role: "info",
				text: `[cron] ${event.jobName}\n${event.text}`,
			};
		case "session_cleared":
		case "session_switched":
			return { type: "clear" };
		case "history_replay": {
			let id = 1;
			const messages: TuiMessage[] = event.messages.map((m) => ({
				id: id++,
				role: m.role,
				text: replayContent(m),
			}));
			return { type: "replay", messages };
		}
		case "session_menu":
			return {
				type: "session_menu",
				data: {
					activeSessionId: event.activeSessionId,
					sessions: event.sessions,
				},
			};
		case "session_renamed":
		case "session_deleted":
		case "session_info":
		case "session_list":
			return { type: "noop" };
	}
}

function replayContent(m: {
	role: string;
	content: string;
	images?: Array<{ path?: string; mediaType?: string }>;
}): string {
	if (m.role === "assistant") return m.content;
	const parts: string[] = [];
	if (m.content) parts.push(m.content);
	for (const img of m.images ?? []) {
		parts.push(img.path ? `[image: ${img.path}]` : "[image]");
	}
	return parts.join("\n");
}

export function applyAction(state: TuiState, action: TuiAction): TuiState {
	switch (action.type) {
		case "append_streaming":
			return {
				...state,
				streaming: state.streaming + action.text,
				running: true,
			};
		case "commit_streaming": {
			if (!state.streaming) {
				return { ...state, running: false };
			}
			return {
				...state,
				messages: [
					...state.messages,
					{
						id: state.nextId,
						role: "assistant" as const,
						text: state.streaming,
					},
				],
				streaming: "",
				running: false,
				nextId: state.nextId + 1,
			};
		}
		case "push":
			return {
				...state,
				messages: [
					...state.messages,
					{ id: state.nextId, role: action.role, text: action.text },
				],
				nextId: state.nextId + 1,
			};
		case "push_and_stop": {
			const msgs = [...state.messages];
			let { nextId } = state;
			if (state.streaming) {
				msgs.push({
					id: nextId,
					role: "assistant" as const,
					text: state.streaming,
				});
				nextId++;
			}
			msgs.push({ id: nextId, role: action.role, text: action.text });
			nextId++;
			return {
				...state,
				messages: msgs,
				streaming: "",
				running: false,
				nextId,
			};
		}
		case "clear":
			return { ...state, messages: [], streaming: "", running: false };
		case "replay": {
			const maxId = action.messages.reduce((max, m) => Math.max(max, m.id), 0);
			return { ...state, messages: action.messages, nextId: maxId + 1 };
		}
		case "noop":
		case "session_menu":
			return state;
	}
}
