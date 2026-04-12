export type TuiMessageRole =
	| "user"
	| "assistant"
	| "thinking"
	| "info"
	| "error"
	| "status";

export interface TuiMessage {
	readonly id: number;
	readonly role: TuiMessageRole;
	readonly text: string;
	readonly replyText?: string;
}

export interface TuiState {
	messages: TuiMessage[];
	streaming: string;
	streamingThinking: string;
	running: boolean;
	nextId: number;
}

export function initialTuiState(): TuiState {
	return {
		messages: [],
		streaming: "",
		streamingThinking: "",
		running: false,
		nextId: 1,
	};
}
