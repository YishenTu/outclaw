// --- Client → Server messages ---

export interface PromptMessage {
	type: "prompt";
	prompt: string;
	source?: "telegram";
}

export interface CommandMessage {
	type: "command";
	command: string;
}

export type ClientMessage = PromptMessage | CommandMessage;

// --- Server → Client events ---

export interface TextEvent {
	type: "text";
	text: string;
}

export interface StatusEvent {
	type: "status";
	message: string;
}

export interface ErrorEvent {
	type: "error";
	message: string;
}

export interface UsageInfo {
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	contextWindow: number;
	maxOutputTokens: number;
	contextTokens: number;
	percentage: number;
}

export interface DoneEvent {
	type: "done";
	sessionId: string;
	durationMs: number;
	costUsd?: number;
	usage?: UsageInfo;
}

export interface UserPromptEvent {
	type: "user_prompt";
	prompt: string;
	source: string;
}

export interface SessionClearedEvent {
	type: "session_cleared";
}

export interface ModelChangedEvent {
	type: "model_changed";
	model: string;
}

export interface EffortChangedEvent {
	type: "effort_changed";
	effort: string;
}

export interface SessionInfoEvent {
	type: "session_info";
	sdkSessionId: string;
	title: string;
	model: string;
}

export interface SessionListEvent {
	type: "session_list";
	sessions: Array<{
		sdkSessionId: string;
		title: string;
		model: string;
		lastActive: number;
	}>;
}

export interface SessionSwitchedEvent {
	type: "session_switched";
	sdkSessionId: string;
	title: string;
}

export interface RuntimeStatusEvent {
	type: "runtime_status";
	model: string;
	effort: string;
	sessionId?: string;
	usage?: UsageInfo;
}

export interface HistoryReplayEvent {
	type: "history_replay";
	messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export type ServerEvent =
	| TextEvent
	| StatusEvent
	| ErrorEvent
	| DoneEvent
	| UserPromptEvent
	| SessionClearedEvent
	| ModelChangedEvent
	| EffortChangedEvent
	| SessionInfoEvent
	| SessionListEvent
	| SessionSwitchedEvent
	| RuntimeStatusEvent
	| HistoryReplayEvent;

// --- Facade types (backend contract) ---

export type FacadeEvent = TextEvent | StatusEvent | ErrorEvent | DoneEvent;

export interface RunParams {
	prompt: string;
	systemPrompt?: string;
	abortController?: AbortController;
	resume?: string;
	maxTurns?: number;
	cwd?: string;
	model?: string;
	effort?: string;
}

export interface Facade {
	run(params: RunParams): AsyncIterable<FacadeEvent>;
}

// --- Helpers ---

export function parseMessage(data: string | Buffer): unknown {
	return JSON.parse(String(data));
}

export function serialize(event: ServerEvent | ClientMessage): string {
	return JSON.stringify(event);
}

export function extractError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
