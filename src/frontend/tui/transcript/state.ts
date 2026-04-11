export type TuiMessageRole = "user" | "assistant" | "info" | "error" | "status";

export interface TuiMessage {
	readonly id: number;
	readonly role: TuiMessageRole;
	readonly text: string;
}

export interface TuiState {
	messages: TuiMessage[];
	streaming: string;
	running: boolean;
	nextId: number;
}

export function initialTuiState(): TuiState {
	return { messages: [], streaming: "", running: false, nextId: 1 };
}
