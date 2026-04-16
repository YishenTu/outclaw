// --- Client → Server messages ---

export type ImageMediaType =
	| "image/jpeg"
	| "image/png"
	| "image/gif"
	| "image/webp";

export interface ImageRef {
	path: string;
	mediaType: ImageMediaType;
}

export interface DisplayImage {
	path?: string;
	mediaType?: ImageMediaType;
}

export interface ReplyContext {
	text: string;
}

export interface PromptMessage {
	type: "prompt";
	prompt: string;
	images?: ImageRef[];
	replyContext?: ReplyContext;
	source?: "telegram";
	telegramChatId?: number;
}

export interface CommandMessage {
	type: "command";
	command: string;
}

export interface AskMessage {
	type: "ask";
	fromAgentId: string;
	to: string;
	message: string;
}

export type RuntimeClientType = "telegram" | "tui" | "browser" | "control";

export interface HeartbeatDeliveryTarget {
	clientType: RuntimeClientType;
	telegramChatId?: number;
}

export interface HeartbeatResult {
	images: Array<{
		path: string;
		caption?: string;
	}>;
	text: string;
}

export interface RequestSkillsMessage {
	type: "request_skills";
}

export type ClientMessage =
	| PromptMessage
	| CommandMessage
	| RequestSkillsMessage
	| AskMessage;

// --- Server → Client events ---

export interface TextEvent {
	type: "text";
	text: string;
}

export interface ImageEvent {
	type: "image";
	path: string;
	caption?: string;
}

export interface StatusEvent {
	type: "status";
	message: string;
}

export interface ThinkingEvent {
	type: "thinking";
	text: string;
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
	images?: DisplayImage[];
	replyContext?: ReplyContext;
	source: string;
}

export interface CompactingStartedEvent {
	type: "compacting_started";
}

export interface CompactingFinishedEvent {
	type: "compacting_finished";
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

export interface SessionMenuEvent {
	type: "session_menu";
	activeSessionId?: string;
	sessions: Array<{
		sdkSessionId: string;
		title: string;
		model: string;
		lastActive: number;
	}>;
}

export interface SessionRenamedEvent {
	type: "session_renamed";
	sdkSessionId: string;
	title: string;
}

export interface SessionDeletedEvent {
	type: "session_deleted";
	sdkSessionId: string;
}

export interface SessionSwitchedEvent {
	type: "session_switched";
	sdkSessionId: string;
	title: string;
}

export interface AgentMenuEvent {
	type: "agent_menu";
	activeAgentId: string;
	activeAgentName: string;
	agents: Array<{
		agentId: string;
		name: string;
	}>;
}

export interface AgentSwitchedEvent {
	type: "agent_switched";
	agentId: string;
	name: string;
}

export interface RuntimeStatusEvent {
	type: "runtime_status";
	agentName?: string;
	providerId?: string;
	model: string;
	effort: string;
	sessionId?: string;
	sessionTitle?: string;
	usage?: UsageInfo;
	nextHeartbeatAt?: number;
	heartbeatDeferred?: boolean;
	requested?: boolean;
}

export interface DisplayChatMessage {
	kind: "chat";
	role: "user" | "assistant";
	content: string;
	thinking?: string;
	images?: DisplayImage[];
	replyContext?: ReplyContext;
}

export interface DisplaySystemMessage {
	kind: "system";
	event: "compact_boundary";
	text: string;
	trigger: "manual" | "auto";
	preTokens: number;
}

export type DisplayMessage = DisplayChatMessage | DisplaySystemMessage;

export interface TranscriptTurn {
	role: "user" | "assistant";
	content: string;
	timestamp: number;
	images?: DisplayImage[];
	replyContext?: ReplyContext;
}

export interface HistoryReplayEvent {
	type: "history_replay";
	messages: DisplayMessage[];
}

export interface CronResultEvent {
	type: "cron_result";
	jobName: string;
	text: string;
}

export interface SkillInfo {
	name: string;
	description: string;
}

export interface BrowserSessionSummary {
	providerId: string;
	sdkSessionId: string;
	title: string;
	model: string;
	lastActive: number;
}

export interface BrowserAgentSummary {
	agentId: string;
	name: string;
	activeSession?: {
		providerId: string;
		sdkSessionId: string;
	};
	sessions: BrowserSessionSummary[];
}

export interface BrowserAgentsResponse {
	activeAgentId?: string;
	agents: BrowserAgentSummary[];
}

export interface BrowserTreeEntry {
	kind: "file" | "directory";
	name: string;
	path: string;
	children?: BrowserTreeEntry[];
}

export interface BrowserCronEntry {
	name: string;
	path: string;
	schedule: string;
	model?: string;
	enabled: boolean;
	error?: string;
}

export interface BrowserFileResponse {
	path: string;
	kind: "text" | "binary";
	content?: string;
	language?: string;
	truncated: boolean;
}

export interface BrowserGitFileStatus {
	path: string;
	indexStatus: string;
	worktreeStatus: string;
	renamedFrom?: string;
}

export interface BrowserGitStatusResponse {
	root: string;
	branch: string | null;
	ahead: number;
	behind: number;
	clean: boolean;
	graph: string;
	files: BrowserGitFileStatus[];
}

export interface BrowserGitDiffResponse {
	path: string;
	diff: string;
}

export interface SkillsUpdateEvent {
	type: "skills_update";
	skills: SkillInfo[];
}

export interface AskResponseEvent {
	type: "ask_response";
	text: string;
}

export interface AskErrorEvent {
	type: "ask_error";
	message: string;
}

export type ServerEvent =
	| TextEvent
	| ThinkingEvent
	| ImageEvent
	| StatusEvent
	| ErrorEvent
	| DoneEvent
	| UserPromptEvent
	| SessionClearedEvent
	| ModelChangedEvent
	| EffortChangedEvent
	| SessionInfoEvent
	| SessionListEvent
	| SessionMenuEvent
	| SessionRenamedEvent
	| SessionDeletedEvent
	| SessionSwitchedEvent
	| AgentMenuEvent
	| AgentSwitchedEvent
	| RuntimeStatusEvent
	| CompactingStartedEvent
	| CompactingFinishedEvent
	| HistoryReplayEvent
	| CronResultEvent
	| SkillsUpdateEvent
	| AskResponseEvent
	| AskErrorEvent;

// --- Facade types (backend contract) ---

export type FacadeEvent =
	| TextEvent
	| ThinkingEvent
	| ImageEvent
	| StatusEvent
	| ErrorEvent
	| DoneEvent
	| CompactingStartedEvent
	| CompactingFinishedEvent;

export interface RunParams {
	prompt: string;
	images?: ImageRef[];
	replyContext?: ReplyContext;
	systemPrompt?: string;
	abortController?: AbortController;
	resume?: string;
	cwd?: string;
	model?: string;
	effort?: string;
	stream?: boolean;
}

export interface Facade {
	providerId: string;
	run(params: RunParams): AsyncIterable<FacadeEvent>;
	readHistory?(sessionId: string): Promise<DisplayMessage[]>;
	readTranscript?(sessionId: string): Promise<TranscriptTurn[]>;
	getSkills?(cwd?: string): Promise<SkillInfo[]>;
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
