export type TuiMessageRole =
	| "user"
	| "assistant"
	| "thinking"
	| "info"
	| "error"
	| "status";

export type TuiMessageVariant = "compact_boundary";

export interface TuiMessage {
	readonly id: number;
	readonly role: TuiMessageRole;
	readonly text: string;
	readonly replyText?: string;
	readonly variant?: TuiMessageVariant;
}

export interface TuiState {
	messages: TuiMessage[];
	streaming: string;
	streamingThinking: string;
	running: boolean;
	compacting: boolean;
	nextId: number;
}

export function initialTuiState(): TuiState {
	return {
		messages: [],
		streaming: "",
		streamingThinking: "",
		running: false,
		compacting: false,
		nextId: 1,
	};
}
