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

export interface CommandExecutionStartedEvent {
	type: "command_execution_started";
	callId: string;
	command: string;
	cwd?: string;
	sessionId?: string;
}

export interface CommandExecutionCompletedEvent {
	type: "command_execution_completed";
	callId: string;
	exitCode?: number;
	durationMs?: number;
	output?: string;
	sessionId?: string;
}

export interface CommandExecutionOutputEvent {
	type: "command_execution_output";
	callId: string;
	output: string;
	sessionId?: string;
}

export type FileChangeKind = "add" | "update" | "delete" | "move";

export interface FileChange {
	path: string;
	kind: FileChangeKind;
	diff?: string;
	movePath?: string;
}

export interface FileChangeAppliedEvent {
	type: "file_change_applied";
	callId: string;
	changes: FileChange[];
	sessionId?: string;
}

export interface ToolCallDetail {
	label: string;
	value: string;
}

export interface SubagentToolAgentState {
	agentId: string;
	status?: string;
	message?: string;
}

export interface SubagentToolStartedEvent {
	type: "subagent_tool_started";
	callId: string;
	operation: string;
	prompt?: string;
	model?: string;
	reasoningEffort?: string;
	targetIds: string[];
	agentStates: SubagentToolAgentState[];
	sessionId?: string;
}

export interface SubagentToolCompletedEvent {
	type: "subagent_tool_completed";
	callId: string;
	operation: string;
	status?: string;
	prompt?: string;
	model?: string;
	reasoningEffort?: string;
	targetIds: string[];
	agentStates: SubagentToolAgentState[];
	sessionId?: string;
}

/**
 * Web-search tool invocation. `query` may be missing on the started event
 * (Codex emits an empty placeholder before the search resolves) and is
 * populated on the completed event along with the optional `queries` list.
 */
export interface WebSearchStartedEvent {
	type: "web_search_started";
	callId: string;
	query?: string;
	sessionId?: string;
}

export interface WebSearchCompletedEvent {
	type: "web_search_completed";
	callId: string;
	query?: string;
	queries?: string[];
	sessionId?: string;
}

/**
 * Generic catch-all for tool invocations the adapter does not recognize. This
 * keeps unknown or future tool kinds visible in the transcript instead of
 * silently dropping them. Provider adapters project available data into
 * display-oriented fields; runtime/frontend code must not parse provider-native
 * payload objects.
 */
export interface ToolCallStartedEvent {
	type: "tool_call_started";
	callId: string;
	toolKind: string;
	details?: ToolCallDetail[];
	sessionId?: string;
}

export interface ToolCallCompletedEvent {
	type: "tool_call_completed";
	callId: string;
	toolKind: string;
	status?: string;
	details?: ToolCallDetail[];
	sessionId?: string;
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

export interface BrowserChatCodingLinksChangedEvent {
	type: "browser_chat_coding_links_changed";
	chatAgentId: string;
	chatProviderId: string;
	chatSdkSessionId: string;
	codingProviderId: string;
	codingSdkSessionId: string;
}

export interface SkillInfo {
	name: string;
	description: string;
}

export type ProviderSkillScope = "user" | "repo" | "system" | "admin" | string;

export interface ProviderSkillInfo {
	name: string;
	description: string;
	scope?: ProviderSkillScope;
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

export interface BrowserAgentActiveSessionResponse {
	activeSession?: {
		providerId: string;
		sdkSessionId: string;
	};
}

export interface BrowserSessionPageResponse {
	nextCursor?: SessionCursor;
	query?: string;
	sessions: BrowserSessionSummary[];
}

export type BrowserCodingSessionLifecycleStatus = "open" | "archived";
export type BrowserCodingSessionRunStatus =
	| "idle"
	| "running"
	| "failed"
	| "cancelled";

export interface BrowserCodingSessionSummary {
	providerId: string;
	sdkSessionId: string;
	repositoryId?: string;
	title: string;
	model: string;
	lastActive: number;
	cwd: string;
	lifecycleStatus: BrowserCodingSessionLifecycleStatus;
	runStatus: BrowserCodingSessionRunStatus;
	createdAt: number;
	source: string;
	tag: BrowserSessionTag;
	ocSessionId?: string;
	linkedChatSessionId?: string;
	browserTabId?: string;
	failedAt?: number;
	failureMessage?: string;
}

export interface BrowserCodingSessionPageResponse {
	nextCursor?: SessionCursor;
	query?: string;
	sessions: BrowserCodingSessionSummary[];
}

export interface BrowserCodingSessionLinksResponse {
	sessions: BrowserCodingSessionSummary[];
}

export interface BrowserCodingSessionDetail
	extends BrowserCodingSessionSummary {
	events?: BrowserCodingSessionEvent[];
}

export interface BrowserCodingSessionEvent {
	providerId: string;
	sdkSessionId: string;
	sequence: number;
	event: CodingSessionEvent;
	createdAt: number;
}

export interface CodingSessionStreamEvent extends BrowserCodingSessionEvent {
	type: "coding_session_event";
}

export interface BrowserCodingSessionDeleteResponse {
	deleted: true;
	providerId: string;
	sdkSessionId: string;
}

export interface BrowserCodingSessionArchiveResponse {
	archived: true;
	session: BrowserCodingSessionSummary;
}

export interface BrowserCodingSessionRestoreResponse {
	restored: true;
	session: BrowserCodingSessionSummary;
}

export type BrowserCodingSessionStatusState =
	| "running"
	| "done"
	| "error"
	| "cancelled";

export interface BrowserCodingSessionStatusResponse {
	providerId: string;
	sdkSessionId: string;
	ref?: string;
	state: BrowserCodingSessionStatusState;
	repo?: string;
	startedAt?: string;
	lastEventAt?: string;
	durationMs?: number;
	lastPrompt?: string;
	finalResponse?: string;
	error?: string | { message: string };
}

export type BrowserCodingSessionStartResponse =
	| {
			status: "accepted";
			providerId: string;
			sdkSessionId: string;
	  }
	| {
			status: "rejected";
			message: string;
	  };

export type BrowserCodingSessionResumeResponse =
	BrowserCodingSessionStartResponse;

export type BrowserCodingSessionStopResponse =
	BrowserCodingSessionStartResponse;

export type BrowserCodingSessionCancelResponse =
	| {
			status: "accepted";
			providerId: string;
			sdkSessionId: string;
	  }
	| {
			status: "already_terminal";
			providerId: string;
			sdkSessionId: string;
			state: Exclude<BrowserCodingSessionStatusState, "running">;
	  }
	| {
			status: "rejected";
			message: string;
	  };

export interface BrowserCodingModel {
	id: string;
	model: string;
	displayName: string;
	description: string;
	isDefault: boolean;
	defaultReasoningEffort: string;
	supportedReasoningEfforts: string[];
	serviceTiers: ProviderServiceTier[];
}

export interface BrowserCodingModelsResponse {
	models: BrowserCodingModel[];
}

export interface BrowserCodingSkillsResponse {
	skills: ProviderSkillInfo[];
}

export type BrowserCodingRepositorySource = "auto" | "manual" | "clone";
export type BrowserCodingRepositoryStatus = "active" | "archived";

export interface BrowserCodingRepositorySummary {
	id: string;
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

export interface BrowserCodingRepositoryRestoreResponse {
	restored: true;
	repository: BrowserCodingRepositorySummary;
}

export type BrowserCodingRepositoryCloneResponse =
	| { status: "cloned"; repository: BrowserCodingRepositoryDetail }
	| { status: "failed"; message: string };

export type BrowserCodingFolderPickerResponse =
	| { status: "selected"; path: string }
	| { status: "canceled" }
	| { status: "unavailable"; message: string };

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

export interface BrowserGitCommitParent {
	sha: string;
}

export interface BrowserGitHistoryCommit {
	sha: string;
	commit: {
		author: {
			name: string;
			date: string;
			email?: string;
		};
		message: string;
	};
	parents: BrowserGitCommitParent[];
}

export interface BrowserGitHistory {
	commits: BrowserGitHistoryCommit[];
	nextCursor?: string;
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
	history: BrowserGitHistory;
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
	parents: BrowserGitCommitParent[];
	diff: string;
}

export type BrowserGitCommitFileChangeType =
	| "added"
	| "modified"
	| "deleted"
	| "renamed"
	| "copied"
	| "type-changed";

export interface BrowserGitCommitFileStat {
	path: string;
	change: BrowserGitCommitFileChangeType;
	renamedFrom?: string;
	additions: number;
	deletions: number;
	binary: boolean;
}

export interface BrowserGitCommitStats {
	sha: string;
	files: BrowserGitCommitFileStat[];
	totalAdditions: number;
	totalDeletions: number;
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
	providerId: string;
	sdkSessionId: string;
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
	| TurnAbortedEvent
	| DoneEvent
	| UsageUpdatedEvent
	| CommandExecutionStartedEvent
	| CommandExecutionOutputEvent
	| CommandExecutionCompletedEvent
	| FileChangeAppliedEvent
	| SubagentToolStartedEvent
	| SubagentToolCompletedEvent
	| WebSearchStartedEvent
	| WebSearchCompletedEvent
	| ToolCallStartedEvent
	| ToolCallCompletedEvent
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
	| BrowserChatCodingLinksChangedEvent
	| CodingSessionStreamEvent
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
	| TurnAbortedEvent
	| SessionInitializedEvent
	| DoneEvent
	| UsageUpdatedEvent
	| CommandExecutionStartedEvent
	| CommandExecutionOutputEvent
	| CommandExecutionCompletedEvent
	| FileChangeAppliedEvent
	| SubagentToolStartedEvent
	| SubagentToolCompletedEvent
	| WebSearchStartedEvent
	| WebSearchCompletedEvent
	| ToolCallStartedEvent
	| ToolCallCompletedEvent
	| CompactingStartedEvent
	| CompactingFinishedEvent;

export interface CodingUserPromptEvent {
	type: "user_prompt";
	text: string;
	sessionId?: string;
}

export interface TurnAbortedEvent {
	type: "turn_aborted";
	sessionId?: string;
}

export type CodingSessionEvent =
	| FacadeEvent
	| CodingUserPromptEvent
	| TurnAbortedEvent;

/**
 * Mid-stream usage update. Codex emits `thread/tokenUsage/updated` while a
 * turn is in flight; surfacing this lets the context gauge tick along with
 * the turn instead of waiting for the final `done` event. Adapters that lack
 * an equivalent signal simply never emit this.
 */
export interface UsageUpdatedEvent {
	type: "usage_updated";
	usage: UsageInfo;
	sessionId?: string;
}

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
	/**
	 * Provider-side service tier override. Codex's `model/list` advertises a
	 * `serviceTiers` array per model; the canonical id (e.g. `priority`) is
	 * passed verbatim. Adapters that don't expose a tiering knob ignore this.
	 */
	serviceTier?: string;
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
	/**
	 * Provider-owned same-turn steering for an active coding session. Runtime
	 * decides when a coding session should be steered; adapters own the
	 * provider-native active-turn identity and request shape.
	 */
	steerCodingSession?(params: {
		sessionId: string;
		prompt: string;
		cwd?: string;
	}): Promise<{ sessionId: string; turnId?: string }>;
	readHistory?(sessionId: string): Promise<DisplayMessage[]>;
	readReplay?(sessionId: string): Promise<DisplayMessage[]>;
	readTranscript?(sessionId: string): Promise<TranscriptTurn[]>;
	/**
	 * Provider-owned rehydration hook for coding-session history. Adapters
	 * project provider-native persisted artifacts into the same coding-session
	 * event shapes used by live streaming; runtime/frontend code must not parse
	 * provider transcript formats directly.
	 */
	readCodingSessionEvents?(sessionId: string): Promise<CodingSessionEvent[]>;
	getSkills?(cwd?: string): Promise<SkillInfo[]>;
	/**
	 * Provider-owned skill catalog for cwd-bound coding sessions. This is
	 * intentionally separate from getSkills(), which feeds the normal chat
	 * slash-command transport.
	 */
	listProviderSkills?(params: {
		cwd: string;
		forceReload?: boolean;
	}): Promise<ProviderSkillInfo[]>;
	/**
	 * List provider-side models the runtime can offer to the user. Coding
	 * mode uses this to populate the model picker so users can pick a Codex
	 * model and a matching reasoning effort without the runtime hardcoding
	 * the catalog.
	 */
	listModels?(): Promise<ProviderModelInfo[]>;
	dispose?(): Promise<void> | void;
}

export interface ProviderModelInfo {
	id: string;
	model: string;
	displayName: string;
	description: string;
	isDefault: boolean;
	defaultReasoningEffort: string;
	supportedReasoningEfforts: string[];
	/**
	 * Service tiers the model exposes (e.g. Codex's `priority`/Fast). Empty
	 * when the provider has no tiering or the current model offers none.
	 */
	serviceTiers: ProviderServiceTier[];
}

export interface ProviderServiceTier {
	id: string;
	name: string;
	description: string;
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
