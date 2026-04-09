export type TuiMessageRole = "user" | "assistant" | "info" | "error";

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

export interface SessionMenuData {
	activeSessionId?: string;
	sessions: Array<{
		sdkSessionId: string;
		title: string;
		model: string;
		lastActive: number;
	}>;
}
