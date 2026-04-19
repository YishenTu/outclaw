export type TuiMessageRole =
	| "user"
	| "assistant"
	| "thinking"
	| "info"
	| "error"
	| "status";

export type TuiMessageVariant = "compact_boundary" | "heartbeat" | "rollover";

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
	heartbeatPending: boolean;
	heartbeatStreaming: string;
	heartbeatStreamingThinking: string;
	running: boolean;
	compacting: boolean;
	nextId: number;
}

export function initialTuiState(): TuiState {
	return {
		messages: [],
		streaming: "",
		streamingThinking: "",
		heartbeatPending: false,
		heartbeatStreaming: "",
		heartbeatStreamingThinking: "",
		running: false,
		compacting: false,
		nextId: 1,
	};
}
