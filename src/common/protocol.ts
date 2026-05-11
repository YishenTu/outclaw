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

export type DisplayImage =
	| {
			kind: "managed";
			path: string;
			mediaType: ImageMediaType;
	  }
	| {
			kind: "inline";
			base64: string;
			mediaType: ImageMediaType;
	  }
	| {
			kind: "placeholder";
			mediaType: ImageMediaType;
	  };

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

export interface SendMessage {
	type: "send";
	fromAgentId: string;
	to: string;
	message: string;
}

export interface CronRunMessage {
	type: "cron_run";
	cwd: string;
	jobName: string;
}

export interface CodePromptMessage {
	type: "code_prompt";
	cwd: string;
	prompt: string;
}

export type RuntimeClientType = "telegram" | "tui" | "browser" | "control";
export type PromptSource =
	| "telegram"
	| "heartbeat"
	| "rollover"
	| "tui"
	| "browser"
	| "agent";

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

export interface RequestFilesMessage {
	type: "request_files";
}

export type ClientMessage =
	| PromptMessage
	| CommandMessage
	| RequestSkillsMessage
	| RequestFilesMessage
	| AskMessage
	| SendMessage
	| CronRunMessage
	| CodePromptMessage;

// --- Server → Client events ---

export interface TextEvent {
	type: "text";
	text: string;
	sessionId?: string;
}

export interface ImageEvent {
	type: "image";
	path: string;
	mediaType?: ImageMediaType;
	caption?: string;
	sessionId?: string;
}

export interface StatusEvent {
	type: "status";
	message: string;
	presentation?: "popup" | "inline";
}

export interface ThinkingEvent {
	type: "thinking";
	text: string;
	sessionId?: string;
}

export interface ErrorEvent {
	type: "error";
	message: string;
	sessionId?: string;
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

export interface SessionInitializedEvent {
	type: "session_initialized";
	sessionId: string;
}

export interface UserPromptEvent {
	type: "user_prompt";
	prompt: string;
	images?: DisplayImage[];
	replyContext?: ReplyContext;
	source: PromptSource;
	sessionId?: string;
}

export interface CompactingStartedEvent {
	type: "compacting_started";
	sessionId?: string;
}

export interface CompactingFinishedEvent {
	type: "compacting_finished";
	sessionId?: string;
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

export interface SessionCursor {
	lastActive: number;
	sdkSessionId: string;
}

export interface SessionListEvent {
	type: "session_list";
	activeSessionId?: string;
	sessions: Array<{
		sdkSessionId: string;
		title: string;
		model: string;
		lastActive: number;
	}>;
	nextCursor?: SessionCursor;
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
	nextCursor?: SessionCursor;
}

export interface SessionSearchResultEvent {
	type: "session_search_result";
	query: string;
	sessions: Array<{
		sdkSessionId: string;
		title: string;
		model: string;
		lastActive: number;
	}>;
	nextCursor?: SessionCursor;
}

export interface SessionRenamedEvent {
	type: "session_renamed";
	sdkSessionId: string;
	title: string;
	providerId?: string;
	active?: boolean;
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

export type MemoryFileCommandName =
	| "notes"
	| "schema"
	| "daily-memories"
	| "working-files";

export interface MemoryFileReference {
	id: string;
	name: string;
	path: string;
}

export interface MemoryFileMenuEvent {
	type: "memory_file_menu";
	command: MemoryFileCommandName;
	title: string;
	rootPath: string;
	files: MemoryFileReference[];
}

export interface MemoryFileContentEvent {
	type: "memory_file_content";
	command: MemoryFileCommandName;
	name: string;
	path: string;
	content: string;
}

export interface RestartRequiredNotice {
	kind: "restart_required";
}

export interface RolloverNotice {
	kind: "rollover";
	message: string;
	finalCheck?: "failed";
}

export type FrontendNotice = RestartRequiredNotice | RolloverNotice;

export interface RuntimeStatusEvent {
	type: "runtime_status";
	agentName?: string;
	providerId?: string;
	model: string;
	effort: string;
	running: boolean;
	sessionId?: string;
	sessionTitle?: string;
	usage?: UsageInfo;
	nextHeartbeatAt?: number;
	heartbeatDeferred?: boolean;
	notice?: FrontendNotice;
	requested?: boolean;
}

export interface DisplayChatMessage {
	kind: "chat";
	role: "user" | "assistant";
	content: string;
	thinking?: string;
	images?: DisplayImage[];
	replyContext?: ReplyContext;
	timestamp?: number;
	assistantTurn?: AssistantTurnMetadata;
}

export type AssistantTurnSource = "user" | "heartbeat" | "rollover";

export interface AssistantTurnMetadata {
	source: AssistantTurnSource;
	startedAt?: number;
	durationMs?: number;
}

export interface DisplayCompactBoundaryMessage {
	kind: "system";
	event: "compact_boundary";
	text: string;
	trigger?: "manual" | "auto";
	preTokens?: number;
}

export interface DisplayHeartbeatMessage {
	kind: "system";
	event: "heartbeat";
	text: string;
}

export interface DisplayRolloverMessage {
	kind: "system";
	event: "rollover";
	text: string;
}

export interface DisplayStatusMessage {
	kind: "system";
	event: "status";
	text: string;
	timestamp?: number;
}

export type DisplaySystemMessage =
	| DisplayCompactBoundaryMessage
	| DisplayHeartbeatMessage
	| DisplayRolloverMessage
	| DisplayStatusMessage;

export type DisplayMessage = DisplayChatMessage | DisplaySystemMessage;

export interface TranscriptTurn {
	role: "user" | "assistant";
	content: string;
	timestamp: number;
	images?: DisplayImage[];
	replyContext?: ReplyContext;
	source?: PromptSource;
}

export interface HistoryReplayEvent {
	type: "history_replay";
	sdkSessionId: string;
	messages: DisplayMessage[];
}

export interface StreamingSyncEvent {
	type: "streaming_sync";
	sdkSessionId: string;
	text: string;
	thinking: string;
	images: DisplayImage[];
}

export interface CronResultEvent {
	type: "cron_result";
	jobName: string;
	providerId: string;
	text: string;
	sessionId?: string;
	ranAt: number;
}

export interface BrowserSidebarInvalidatedEvent {
	type: "browser_sidebar_invalidated";
	agentId?: string;
	sections: Array<"tree" | "cron" | "git" | "inbox">;
}

export interface BrowserAgentsInvalidatedEvent {
	type: "browser_agents_invalidated";
	agentId?: string;
}

export interface BrowserAgentActiveSessionChangedEvent {
	type: "browser_agent_active_session_changed";
	agentId: string;
	activeSession?: {
		providerId: string;
		sdkSessionId: string;
	};
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

export type BrowserSessionTag = "chat" | "cron" | "code";

export interface BrowserAgentSummary {
	agentId: string;
	name: string;
	terminalRunCommand?: string;
	activeSession?: {
		providerId: string;
		sdkSessionId: string;
	};
	nextSessionCursor?: SessionCursor;
	sessions: BrowserSessionSummary[];
}

export interface BrowserAgentsResponse {
	activeAgentId?: string;
	agents: BrowserAgentSummary[];
}

export interface BrowserSessionPageResponse {
	nextCursor?: SessionCursor;
	query?: string;
	sessions: BrowserSessionSummary[];
}

export type BrowserCodingSessionStatus = "running" | "completed" | "failed";

export interface BrowserLinkedChatSession {
	agentId: string;
	providerId: string;
	sessionId: string;
}

export interface BrowserCodingSessionSummary {
	providerId: string;
	sdkSessionId: string;
	repositoryId?: string;
	title: string;
	model: string;
	lastActive: number;
	cwd: string;
	status: BrowserCodingSessionStatus;
	createdAt: number;
	source: string;
	tag: BrowserSessionTag;
	ocSessionId?: string;
	linkedChat?: BrowserLinkedChatSession;
	browserTabId?: string;
	failedAt?: number;
	failureMessage?: string;
}

export interface BrowserCodingSessionPageResponse {
	nextCursor?: SessionCursor;
	sessions: BrowserCodingSessionSummary[];
}

export interface BrowserCodingSessionDetail
	extends BrowserCodingSessionSummary {}

export interface BrowserCodingSessionDeleteResponse {
	deleted: true;
	providerId: string;
	sdkSessionId: string;
}

export type BrowserCodingRepositorySource = "auto" | "manual" | "clone";
export type BrowserCodingRepositoryStatus = "active" | "archived";

export interface BrowserCodingRepositorySummary {
	id: string;
	defaultAgentId: string;
	rootCwd: string;
	displayName: string;
	remoteUrl?: string;
	source: BrowserCodingRepositorySource;
	status: BrowserCodingRepositoryStatus;
	createdAt: number;
	lastActive: number;
	archivedAt?: number;
}

export interface BrowserCodingRepositoryDetail
	extends BrowserCodingRepositorySummary {}

export interface BrowserCodingRepositoryListResponse {
	repositories: BrowserCodingRepositorySummary[];
}

export interface BrowserCodingRepositoryArchiveResponse {
	archived: true;
	repository: BrowserCodingRepositorySummary;
}

export interface BrowserLatencyResponse {
	ok: true;
	serverTimeMs: number;
}

export interface BrowserTerminalRunCommandResponse {
	command: string;
}

export type BrowserTreeEntryGitStatus = "modified" | "new";

export interface BrowserTreeEntry {
	kind: "file" | "directory";
	name: string;
	path: string;
	gitStatus?: BrowserTreeEntryGitStatus;
	children?: BrowserTreeEntry[];
}

export interface BrowserGraphNode {
	id: string;
	name: string;
	path: string | null;
	resolved: boolean;
}

export interface BrowserGraphLink {
	source: string;
	target: string;
}

export interface BrowserGraphResponse {
	nodes: BrowserGraphNode[];
	links: BrowserGraphLink[];
}

export interface BrowserCronHistoryCursor {
	ranAt: number;
	providerId: string;
	sessionId: string;
}

export interface BrowserCronRunEntry {
	providerId: string;
	sessionId: string;
	ranAt: number;
	resultText: string;
}

export interface BrowserCronHistoryResponse {
	entries: BrowserCronRunEntry[];
	hasMore: boolean;
}

export interface BrowserCronEntry {
	name: string;
	path: string;
	schedule: string;
	scheduleKind?: "recurring" | "once";
	runAt?: string;
	timezone?: string;
	model?: string;
	effort?: string;
	enabled: boolean;
	status: "scheduled" | "expired" | "disabled" | "invalid";
	error?: string;
}

export type BrowserInboxItemLocation = "inbox" | "archive";

export interface BrowserInboxItem {
	location: BrowserInboxItemLocation;
	modifiedAt: string;
	name: string;
	path: string;
	size: number;
}

export interface BrowserInboxResponse {
	archivedItems: BrowserInboxItem[];
	items: BrowserInboxItem[];
	pendingCount: number;
}

export interface BrowserInboxArchiveResponse {
	archivedPath: string;
	item: BrowserInboxItem;
	originalPath: string;
}

export interface BrowserInboxCreateNoteInput {
	body: string;
	title?: string;
}

export interface BrowserInboxCreateNoteResponse {
	item: BrowserInboxItem;
	path: string;
}

export interface BrowserInboxRestoreResponse {
	archivedPath: string;
	item: BrowserInboxItem;
	restoredPath: string;
}

export interface BrowserFileGitChange {
	path: string;
	status: BrowserTreeEntryGitStatus;
}

export interface BrowserFileResponse {
	path: string;
	kind: "text" | "binary";
	content?: string;
	gitChange?: BrowserFileGitChange;
	language?: string;
	mtimeMs?: number;
	sha256?: string;
	truncated: boolean;
}

export type BrowserConfigSchemaEditorKind =
	| "array"
	| "boolean"
	| "number"
	| "object"
	| "string";

export type BrowserConfigSchemaStringFormat = "env_ref";

export interface BrowserConfigSchemaLeafNode {
	kind: "leaf";
	editorKinds: readonly BrowserConfigSchemaEditorKind[];
	stringFormat?: BrowserConfigSchemaStringFormat;
	typeLabel: string;
}

export interface BrowserConfigSchemaObjectNode {
	kind: "object";
	properties?: Record<string, BrowserConfigSchemaNode>;
	additionalProperties?: BrowserConfigSchemaNode;
}

export type BrowserConfigSchemaNode =
	| BrowserConfigSchemaLeafNode
	| BrowserConfigSchemaObjectNode;

export interface BrowserConfigResponse extends BrowserFileResponse {
	schema: BrowserConfigSchemaNode;
}

export interface BrowserImageUploadResponse {
	images: ImageRef[];
}

export interface BrowserGitFileStatus {
	path: string;
	indexStatus: string;
	worktreeStatus: string;
	additions: number;
	deletions: number;
	renamedFrom?: string;
}

export interface BrowserGitGraphCommitParent {
	sha: string;
}

export interface BrowserGitGraphCommit {
	sha: string;
	commit: {
		author: {
			name: string;
			date: string;
			email?: string;
		};
		message: string;
	};
	parents: BrowserGitGraphCommitParent[];
}

export interface BrowserGitGraphBranchHead {
	name: string;
	commit: {
		sha: string;
	};
}

export interface BrowserGitGraph {
	commits: BrowserGitGraphCommit[];
	branchHeads: BrowserGitGraphBranchHead[];
}

export interface BrowserGitUninitializedResponse {
	initialized: false;
	root: string;
}

export interface BrowserGitInitializedResponse {
	initialized: true;
	root: string;
	branch: string | null;
	ahead: number;
	behind: number;
	clean: boolean;
	graph: BrowserGitGraph;
	files: BrowserGitFileStatus[];
}

export type BrowserGitStatusResponse =
	| BrowserGitUninitializedResponse
	| BrowserGitInitializedResponse;

export interface BrowserGitDiffResponse {
	path: string;
	diff: string;
}

export interface BrowserGitCommitResponse {
	sha: string;
	author: {
		name: string;
		email: string;
		date: string;
	};
	message: string;
	parents: BrowserGitGraphCommitParent[];
	diff: string;
}

export interface SkillsUpdateEvent {
	type: "skills_update";
	skills: SkillInfo[];
}

export interface WorkspaceFileEntry {
	kind: "file" | "directory";
	path: string;
}

export interface WorkspaceFilesUpdateEvent {
	type: "workspace_files_update";
	entries: WorkspaceFileEntry[];
}

export interface AskResponseEvent {
	type: "ask_response";
	text: string;
}

export interface AskErrorEvent {
	type: "ask_error";
	message: string;
}

export interface SendResponseEvent {
	type: "send_response";
}

export interface SendErrorEvent {
	type: "send_error";
	message: string;
}

export interface CronRunResponseEvent {
	type: "cron_run_response";
	jobName: string;
}

export interface CronRunErrorEvent {
	type: "cron_run_error";
	message: string;
}

export interface CodePromptResponseEvent {
	type: "code_prompt_response";
	ocSessionId: string;
}

export interface CodePromptErrorEvent {
	type: "code_prompt_error";
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
	| SessionSearchResultEvent
	| SessionRenamedEvent
	| SessionDeletedEvent
	| SessionSwitchedEvent
	| AgentMenuEvent
	| AgentSwitchedEvent
	| MemoryFileMenuEvent
	| MemoryFileContentEvent
	| RuntimeStatusEvent
	| CompactingStartedEvent
	| CompactingFinishedEvent
	| HistoryReplayEvent
	| StreamingSyncEvent
	| CronResultEvent
	| BrowserSidebarInvalidatedEvent
	| BrowserAgentsInvalidatedEvent
	| BrowserAgentActiveSessionChangedEvent
	| SkillsUpdateEvent
	| WorkspaceFilesUpdateEvent
	| AskResponseEvent
	| AskErrorEvent
	| SendResponseEvent
	| SendErrorEvent
	| CronRunResponseEvent
	| CronRunErrorEvent
	| CodePromptResponseEvent
	| CodePromptErrorEvent;

// --- Facade types (backend contract) ---

export type FacadeEvent =
	| TextEvent
	| ThinkingEvent
	| ImageEvent
	| StatusEvent
	| ErrorEvent
	| SessionInitializedEvent
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
	/**
	 * Preferred session id for a new conversation. The adapter may map this to
	 * a provider-native "use this session id" option when supported.
	 *
	 * Do not set this on resumed runs unless the provider explicitly supports
	 * combining both semantics.
	 */
	sessionId?: string;
	cwd?: string;
	model?: string;
	effort?: string;
	stream?: boolean;
	/**
	 * Tool names allowed for this run. Omitted means the adapter default tool set.
	 * An empty list means no tools.
	 */
	tools?: string[];
	/**
	 * Hint that provider-native artifacts created only for this run should be
	 * discarded after the run settles when the adapter supports cleanup.
	 */
	ephemeral?: boolean;
	/**
	 * Environment variables to inject into the agent session and its tool
	 * subprocesses. Provider-neutral; the adapter maps this to its transport
	 * (e.g. the Claude SDK's `env` option).
	 */
	sessionEnv?: Record<string, string>;
}

export interface Facade {
	providerId: string;
	prepareWorkspace?(promptHomeDir: string): void;
	run(params: RunParams): AsyncIterable<FacadeEvent>;
	readHistory?(sessionId: string): Promise<DisplayMessage[]>;
	readReplay?(sessionId: string): Promise<DisplayMessage[]>;
	readTranscript?(sessionId: string): Promise<TranscriptTurn[]>;
	getSkills?(cwd?: string): Promise<SkillInfo[]>;
	dispose?(): Promise<void> | void;
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
