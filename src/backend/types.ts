export interface RunParams {
	prompt: string;
	systemPrompt?: string;
	abortController?: AbortController;
	resume?: string;
	maxTurns?: number;
	cwd?: string;
}

export type FacadeEvent =
	| { type: "text"; text: string }
	| { type: "status"; message: string }
	| { type: "error"; message: string }
	| { type: "done"; sessionId: string; durationMs: number; costUsd?: number };

export interface Facade {
	run(params: RunParams): AsyncIterable<FacadeEvent>;
}
