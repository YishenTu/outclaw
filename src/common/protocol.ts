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

export interface DoneEvent {
	type: "done";
	sessionId: string;
	durationMs: number;
	costUsd?: number;
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

export type ServerEvent =
	| TextEvent
	| StatusEvent
	| ErrorEvent
	| DoneEvent
	| UserPromptEvent
	| SessionClearedEvent
	| ModelChangedEvent
	| EffortChangedEvent;

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
