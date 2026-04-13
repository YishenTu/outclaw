import type { SessionMenuData } from "../sessions/types.ts";
import type { TuiMessage, TuiMessageRole, TuiState } from "./state.ts";

export type TuiAction =
	| { type: "append_streaming"; text: string }
	| { type: "append_thinking"; text: string }
	| { type: "commit_streaming" }
	| {
			type: "push";
			role: TuiMessageRole;
			text: string;
			replyText?: string;
			variant?: TuiMessage["variant"];
	  }
	| {
			type: "push_and_stop";
			role: TuiMessageRole;
			text: string;
			replyText?: string;
			variant?: TuiMessage["variant"];
	  }
	| { type: "clear" }
	| { type: "replay"; messages: TuiMessage[] }
	| { type: "session_menu"; data: SessionMenuData }
	| { type: "start_compacting" }
	| { type: "finish_compacting" }
	| { type: "noop" };

function flushStreamingBuffers(
	messages: TuiMessage[],
	nextId: number,
	state: TuiState,
): { messages: TuiMessage[]; nextId: number } {
	if (state.streamingThinking) {
		messages.push({
			id: nextId,
			role: "thinking" as const,
			text: state.streamingThinking,
		});
		nextId += 1;
	}
	if (state.streaming) {
		messages.push({
			id: nextId,
			role: "assistant" as const,
			text: state.streaming,
		});
		nextId += 1;
	}
	return { messages, nextId };
}

export function applyAction(state: TuiState, action: TuiAction): TuiState {
	switch (action.type) {
		case "append_streaming":
			return {
				...state,
				streaming: state.streaming + action.text,
				running: true,
			};
		case "append_thinking":
			return {
				...state,
				streamingThinking: state.streamingThinking + action.text,
				running: true,
			};
		case "commit_streaming": {
			if (!state.streaming && !state.streamingThinking) {
				return { ...state, compacting: false, running: false };
			}
			const flushed = flushStreamingBuffers(
				[...state.messages],
				state.nextId,
				state,
			);
			return {
				...state,
				compacting: false,
				messages: flushed.messages,
				streaming: "",
				streamingThinking: "",
				running: false,
				nextId: flushed.nextId,
			};
		}
		case "push":
			return {
				...state,
				messages: [
					...state.messages,
					{
						id: state.nextId,
						role: action.role,
						text: action.text,
						replyText: action.replyText,
						variant: action.variant,
					},
				],
				nextId: state.nextId + 1,
			};
		case "push_and_stop": {
			const flushed = flushStreamingBuffers(
				[...state.messages],
				state.nextId,
				state,
			);
			flushed.messages.push({
				id: flushed.nextId,
				role: action.role,
				text: action.text,
				replyText: action.replyText,
				variant: action.variant,
			});
			return {
				...state,
				compacting: false,
				messages: flushed.messages,
				streaming: "",
				streamingThinking: "",
				running: false,
				nextId: flushed.nextId + 1,
			};
		}
		case "clear":
			return {
				...state,
				compacting: false,
				messages: [],
				streaming: "",
				streamingThinking: "",
				running: false,
			};
		case "replay": {
			const maxId = action.messages.reduce((max, message) => {
				return Math.max(max, message.id);
			}, 0);
			return {
				...state,
				compacting: false,
				messages: action.messages,
				nextId: maxId + 1,
			};
		}
		case "start_compacting":
			return { ...state, compacting: true };
		case "finish_compacting":
			return {
				...state,
				compacting: false,
				messages: [
					...state.messages,
					{
						id: state.nextId,
						role: "info" as const,
						text: "context compacted",
						variant: "compact_boundary" as const,
					},
				],
				nextId: state.nextId + 1,
			};
		case "noop":
		case "session_menu":
			return state;
	}
}
