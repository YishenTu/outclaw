import type { SessionMenuData } from "../sessions/types.ts";
import type { TuiMessage, TuiMessageRole, TuiState } from "./state.ts";

export type TuiAction =
	| { type: "append_streaming"; text: string }
	| { type: "commit_streaming" }
	| { type: "push"; role: TuiMessageRole; text: string }
	| { type: "push_and_stop"; role: TuiMessageRole; text: string }
	| { type: "clear" }
	| { type: "replay"; messages: TuiMessage[] }
	| { type: "session_menu"; data: SessionMenuData }
	| { type: "noop" };

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
			const messages = [...state.messages];
			let { nextId } = state;
			if (state.streaming) {
				messages.push({
					id: nextId,
					role: "assistant" as const,
					text: state.streaming,
				});
				nextId += 1;
			}
			messages.push({ id: nextId, role: action.role, text: action.text });
			nextId += 1;
			return {
				...state,
				messages,
				streaming: "",
				running: false,
				nextId,
			};
		}
		case "clear":
			return { ...state, messages: [], streaming: "", running: false };
		case "replay": {
			const maxId = action.messages.reduce((max, message) => {
				return Math.max(max, message.id);
			}, 0);
			return { ...state, messages: action.messages, nextId: maxId + 1 };
		}
		case "noop":
		case "session_menu":
			return state;
	}
}
