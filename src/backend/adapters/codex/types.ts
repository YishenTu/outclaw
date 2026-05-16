import type { UsageInfo } from "../../../common/protocol.ts";

export interface CodexAppServerClient {
	initialize(): Promise<void>;
	request<T>(method: string, params?: unknown): Promise<T>;
	notify(method: string, params?: unknown): void;
	subscribe(
		handler: (notification: CodexServerNotification) => void,
	): () => void;
	dispose?(): void | Promise<void>;
}

export interface CodexServerNotification {
	method: string;
	params?: unknown;
}

export interface CodexThread {
	id: string;
	name?: string | null;
	sessionId?: string;
	path?: string | null;
}

/**
 * One instruction file the Codex app-server reports it loaded when starting
 * or resuming a thread. Codex may report project docs even when
 * `project_doc_max_bytes` prevents their contents from entering the turn, so
 * this field is informational only.
 */
export interface CodexInstructionSource {
	kind?: string;
	path?: string;
}

export interface CodexThreadStartResult {
	thread: CodexThread;
	instructionSources?: Array<string | CodexInstructionSource>;
}

export type CodexThreadResumeResult = CodexThreadStartResult;
export interface CodexThreadReadResult {
	thread: CodexThread;
}

export interface CodexThreadListResult {
	data: CodexThread[];
	nextCursor?: string | null;
}

export interface CodexTurn {
	id: string;
	durationMs?: number | null;
	status?: string;
	error?: CodexTurnError | null;
}

export interface CodexTurnError {
	message?: string;
	codexErrorInfo?: unknown;
	additionalDetails?: string | null;
}

export interface CodexTurnStartResult {
	turn: CodexTurn;
}

export interface CodexTurnSteerResult {
	turnId: string;
}

export type CodexUserInput =
	| {
			type: "text";
			text: string;
			text_elements: [];
	  }
	| {
			type: "localImage";
			path: string;
	  }
	| {
			type: "skill";
			name: string;
			path: string;
	  };

export type CodexSkillScope = "user" | "repo" | "system" | "admin";

export interface CodexSkillInterface {
	displayName?: string;
	shortDescription?: string;
}

export interface CodexSkillMetadata {
	name: string;
	description?: string;
	shortDescription?: string;
	interface?: CodexSkillInterface;
	path: string;
	scope: CodexSkillScope;
	enabled: boolean;
}

export interface CodexSkillListEntry {
	cwd: string;
	skills: CodexSkillMetadata[];
	errors?: Array<{
		message: string;
		path: string;
	}>;
}

export interface CodexSkillsListResult {
	data: CodexSkillListEntry[];
}

export interface CodexThreadTokenUsage {
	total: CodexTokenUsageBreakdown;
	last: CodexTokenUsageBreakdown;
	modelContextWindow: number | null;
}

export interface CodexTokenUsageBreakdown {
	totalTokens: number;
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	reasoningOutputTokens: number;
}

export interface CodexUsageSnapshot {
	usage: UsageInfo;
	threadId: string;
	turnId: string;
}

export interface CodexModelListResponse {
	data: CodexModelListEntry[];
	nextCursor?: string | null;
}

export interface CodexModelListEntry {
	id: string;
	model: string;
	displayName: string;
	description: string;
	hidden: boolean;
	isDefault: boolean;
	defaultReasoningEffort: string;
	supportedReasoningEfforts: Array<{
		reasoningEffort: string;
		description?: string;
	}>;
	serviceTiers?: Array<{
		id: string;
		name: string;
		description: string;
	}>;
}
