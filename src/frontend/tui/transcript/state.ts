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

export interface TuiQueuedPrompt {
	readonly id: number;
	readonly text: string;
}

export interface TuiState {
	messages: TuiMessage[];
	activePrompt?: TuiMessage;
	streaming: string;
	streamingThinking: string;
	heartbeatPending: boolean;
	heartbeatStreaming: string;
	heartbeatStreamingThinking: string;
	pendingPromptStart: boolean;
	queuedPrompts: TuiQueuedPrompt[];
	running: boolean;
	compacting: boolean;
	nextId: number;
	transcriptVersion: number;
}

export function initialTuiState(): TuiState {
	return {
		messages: [],
		activePrompt: undefined,
		streaming: "",
		streamingThinking: "",
		heartbeatPending: false,
		heartbeatStreaming: "",
		heartbeatStreamingThinking: "",
		pendingPromptStart: false,
		queuedPrompts: [],
		running: false,
		compacting: false,
		nextId: 1,
		transcriptVersion: 0,
	};
}
