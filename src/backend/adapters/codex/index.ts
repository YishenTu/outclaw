import { join } from "node:path";
import { canonicalizePromptSlashCommand } from "../../../common/commands.ts";
import {
	type CodingSessionEvent,
	type DisplayMessage,
	extractError,
	type Facade,
	type FacadeEvent,
	type ProviderCodingSessionUpdate,
	type ProviderModelInfo,
	type ProviderSkillInfo,
	type RunParams,
	type RuntimeExecutionMode,
	type RuntimeInstructionPolicy,
	type TranscriptTurn,
} from "../../../common/protocol.ts";
import {
	type CodexAppServerClientOptions,
	createCodexAppServerClient,
} from "./app-server-client.ts";
import {
	loadCodexJsonlTranscript,
	projectCodexChatDisplayMessages,
	projectCodexChatTranscriptTurns,
} from "./history.ts";
import { formatGptDisplayName } from "./model-naming.ts";
import { CodexNotificationQueue } from "./notification-queue.ts";
import { normalizeCodexTurnNotifications } from "./stream-normalizer.ts";
import type {
	CodexAppServerClient,
	CodexModelListResponse,
	CodexServerNotification,
	CodexSkillMetadata,
	CodexSkillsListResult,
	CodexThread,
	CodexThreadListResult,
	CodexThreadResumeResult,
	CodexThreadStartResult,
	CodexTurnStartResult,
	CodexTurnSteerResult,
	CodexUserInput,
} from "./types.ts";

interface CodexAdapterOptions {
	client?: CodexAppServerClient;
	appServer?: CodexAppServerClientOptions;
}

const DEFAULT_CODEX_REASONING_SUMMARY = "auto";
const CODEX_YOLO_APPROVAL_POLICY = "never";
const CODEX_YOLO_THREAD_SANDBOX = "danger-full-access";
const CODEX_YOLO_TURN_SANDBOX_POLICY = { type: "dangerFullAccess" };
const CODEX_READ_ONLY_THREAD_SANDBOX = "read-only";
const CODEX_READ_ONLY_TURN_SANDBOX_POLICY = {
	type: "readOnly",
	networkAccess: false,
};
const CODEX_THREAD_LIST_SOURCE_KINDS = [
	"cli",
	"vscode",
	"exec",
	"appServer",
	"subAgent",
	"subAgentReview",
	"subAgentCompact",
	"subAgentThreadSpawn",
	"subAgentOther",
	"unknown",
];
const CODEX_THREAD_LIST_PAGE_SIZE = 100;

export class CodexAdapter implements Facade {
	readonly providerId = "codex";
	private readonly injectedClient?: CodexAppServerClient;
	private readonly appServerOptions?: CodexAppServerClientOptions;
	private cachedClient?: CodexAppServerClient;
	private readonly activeTurns = new Map<string, CodexActiveTurn>();
	private readonly codingSessionUpdateHandlers = new Set<
		(update: ProviderCodingSessionUpdate) => void
	>();
	private codingSessionUpdateUnsubscribe?: () => void;

	constructor(options: CodexAdapterOptions = {}) {
		this.injectedClient = options.client;
		this.appServerOptions = options.appServer;
	}

	workspaceMetadata(promptHomeDir: string) {
		return {
			ignoredWorkspaceNames: [".codex"],
			ignoredGitPaths: [join(promptHomeDir, ".codex", "skills")],
		};
	}

	async dispose(): Promise<void> {
		this.codingSessionUpdateUnsubscribe?.();
		this.codingSessionUpdateUnsubscribe = undefined;
		this.codingSessionUpdateHandlers.clear();
		const client = this.cachedClient ?? this.injectedClient;
		this.cachedClient = undefined;
		await client?.dispose?.();
	}

	async listModels(): Promise<ProviderModelInfo[]> {
		const client = await this.loadClient();
		await client.initialize();
		const models: ProviderModelInfo[] = [];
		let cursor: string | undefined;
		do {
			const response = await client.request<CodexModelListResponse>(
				"model/list",
				cursor === undefined ? {} : { cursor },
			);
			for (const entry of response.data) {
				if (entry.hidden) {
					continue;
				}
				models.push({
					id: entry.id,
					model: entry.model.toLowerCase(),
					displayName: formatGptDisplayName(entry.displayName),
					description: entry.description,
					isDefault: entry.isDefault,
					defaultReasoningEffort: entry.defaultReasoningEffort,
					supportedReasoningEfforts: entry.supportedReasoningEfforts.map(
						(effort) => effort.reasoningEffort,
					),
					serviceTiers: (entry.serviceTiers ?? []).map((tier) => ({
						id: tier.id,
						name: tier.name,
						description: tier.description,
					})),
				});
			}
			cursor = response.nextCursor ?? undefined;
		} while (cursor !== undefined);
		return models;
	}

	async listProviderSkills(params: {
		cwd: string;
		forceReload?: boolean;
	}): Promise<ProviderSkillInfo[]> {
		const client = await this.loadClient();
		await client.initialize();
		const skills = await requestCodexSkills(client, params);
		return skills
			.filter((skill) => skill.enabled)
			.sort(compareCodexSkillPriority)
			.map((skill) => ({
				name: skill.name,
				description: getCodexSkillDescription(skill),
				scope: skill.scope,
			}));
	}

	async readCodingSessionEvents(
		sessionId: string,
	): Promise<CodingSessionEvent[]> {
		const { events } = await this.loadJsonlTranscript(sessionId);
		return events;
	}

	/**
	 * Chat-mode history. Reads the same Codex JSONL transcript Code Mode uses
	 * but projects only chat-relevant rows (user/assistant text, reasoning).
	 * Tool/command/file-change traces remain in the coding-session projection.
	 */
	async readHistory(sessionId: string): Promise<DisplayMessage[]> {
		const { events } = await this.loadJsonlTranscript(sessionId);
		return projectCodexChatDisplayMessages(events);
	}

	async readReplay(sessionId: string): Promise<DisplayMessage[]> {
		return this.readHistory(sessionId);
	}

	async readTranscript(sessionId: string): Promise<TranscriptTurn[]> {
		const { events } = await this.loadJsonlTranscript(sessionId);
		const turns = projectCodexChatTranscriptTurns(events);
		if (turns === null) {
			throw new Error(
				`Codex chat transcript export requires durable per-row timestamps; session ${sessionId} has none in its JSONL log`,
			);
		}
		return turns;
	}

	private async loadJsonlTranscript(sessionId: string) {
		const client = await this.loadClient();
		return loadCodexJsonlTranscript({ client, sessionId });
	}

	async steerCodingSession(params: {
		sessionId: string;
		prompt: string;
		cwd?: string;
	}): Promise<{ sessionId: string; turnId: string }> {
		const client = await this.loadClient();
		await client.initialize();
		const activeTurn = this.activeTurns.get(params.sessionId);
		if (!activeTurn) {
			throw new Error(
				`Coding session has no active steerable turn: ${params.sessionId}`,
			);
		}
		const input = await buildUserInput(client, {
			prompt: params.prompt,
			cwd: params.cwd,
		});
		const result = await client.request<CodexTurnSteerResult>("turn/steer", {
			threadId: activeTurn.threadId,
			expectedTurnId: activeTurn.turnId,
			input,
		});
		activeTurn.turnId = result.turnId;
		activeTurn.observedTurnIds.add(result.turnId);
		return {
			sessionId: params.sessionId,
			turnId: result.turnId,
		};
	}

	async archiveCodingSession(sessionId: string): Promise<void> {
		const client = await this.loadClient();
		await client.initialize();
		await client.request("thread/archive", { threadId: sessionId });
	}

	async trashCodingSession(sessionId: string): Promise<void> {
		await this.archiveCodingSession(sessionId);
	}

	async restoreCodingSession(sessionId: string): Promise<void> {
		const client = await this.loadClient();
		await client.initialize();
		await client.request("thread/unarchive", { threadId: sessionId });
	}

	async renameCodingSession(sessionId: string, title: string): Promise<void> {
		const client = await this.loadClient();
		await client.initialize();
		await client.request("thread/name/set", {
			threadId: sessionId,
			name: title,
		});
	}

	async reconcileCodingSessions(
		sessionIds: string[],
	): Promise<ProviderCodingSessionUpdate[]> {
		const requested = new Set(
			sessionIds.map((sessionId) => sessionId.trim()).filter(Boolean),
		);
		if (requested.size === 0) {
			return [];
		}
		const client = await this.loadClient();
		await client.initialize();

		const updates: ProviderCodingSessionUpdate[] = [];
		const found = new Set<string>();
		for (const lifecycleStatus of ["open", "archived"] as const) {
			const remaining = new Set(
				[...requested].filter((sessionId) => !found.has(sessionId)),
			);
			if (remaining.size === 0) {
				break;
			}
			const lifecycleUpdates = await listCodexThreadMetadata(
				client,
				remaining,
				lifecycleStatus,
			);
			for (const update of lifecycleUpdates) {
				found.add(update.sessionId);
				updates.push(update);
			}
		}
		return updates;
	}

	subscribeCodingSessionUpdates(
		handler: (update: ProviderCodingSessionUpdate) => void,
	): () => void {
		this.codingSessionUpdateHandlers.add(handler);
		const existingClient = this.cachedClient ?? this.injectedClient;
		if (existingClient) {
			this.ensureCodingSessionUpdateSubscription(existingClient);
		}
		return () => {
			this.codingSessionUpdateHandlers.delete(handler);
			if (this.codingSessionUpdateHandlers.size === 0) {
				this.codingSessionUpdateUnsubscribe?.();
				this.codingSessionUpdateUnsubscribe = undefined;
			}
		};
	}

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		const startedAtMs = Date.now();
		const client = await this.loadClient();
		const queue = new CodexNotificationQueue();
		const unsubscribe = client.subscribe((notification) => {
			queue.push(notification);
		});
		let threadId: string | undefined;
		let createdEphemeralThreadId: string | undefined;
		let turnId: string | undefined;
		let activeTurn: CodexActiveTurn | undefined;
		let abortListener: (() => void) | undefined;

		try {
			await client.initialize();
			const threadResult = params.resume
				? await client.request<CodexThreadResumeResult>(
						"thread/resume",
						buildThreadResumeParams(params),
					)
				: await client.request<CodexThreadStartResult>(
						"thread/start",
						buildThreadStartParams(params),
					);

			threadId = threadResult.thread.id;
			if (params.ephemeral && !params.resume) {
				createdEphemeralThreadId = threadId;
			}
			yield {
				type: "session_initialized",
				sessionId: threadId,
			};

			if (isCodexCompactionPrompt(params.prompt)) {
				await client.request("thread/compact/start", { threadId });
				yield* normalizeCodexTurnNotifications({
					acceptAnyTurnId: true,
					notifications: queue,
					threadId,
					turnIds: new Set(),
					sessionId: threadId,
					startedAtMs,
				});
				return;
			}

			const input = await buildUserInput(client, params);
			const turnResult = await client.request<CodexTurnStartResult>(
				"turn/start",
				buildTurnStartParams(threadId, params, input),
			);
			turnId = turnResult.turn.id;
			activeTurn = {
				threadId,
				turnId,
				observedTurnIds: new Set([turnId]),
			};
			this.activeTurns.set(threadId, activeTurn);

			abortListener = () => {
				void client
					.request("turn/interrupt", { threadId, turnId })
					.catch(() => {});
			};
			params.abortController?.signal.addEventListener("abort", abortListener, {
				once: true,
			});
			if (params.abortController?.signal.aborted) {
				abortListener();
			}

			yield* normalizeCodexTurnNotifications({
				notifications: queue,
				threadId,
				turnIds: activeTurn.observedTurnIds,
				isCurrentTurnId: (candidate) => activeTurn?.turnId === candidate,
				sessionId: threadId,
				startedAtMs,
			});
		} catch (err) {
			yield {
				type: "error",
				message: extractError(err),
				sessionId: threadId,
			};
		} finally {
			if (threadId && activeTurn) {
				if (this.activeTurns.get(threadId) === activeTurn) {
					this.activeTurns.delete(threadId);
				}
			}
			if (abortListener) {
				params.abortController?.signal.removeEventListener(
					"abort",
					abortListener,
				);
			}
			unsubscribe();
			queue.close();
			if (createdEphemeralThreadId) {
				await archiveEphemeralCodexThread(client, createdEphemeralThreadId);
			}
		}
	}

	private async loadClient(): Promise<CodexAppServerClient> {
		if (this.injectedClient) {
			this.ensureCodingSessionUpdateSubscription(this.injectedClient);
			return this.injectedClient;
		}
		this.cachedClient ??= createCodexAppServerClient(this.appServerOptions);
		this.ensureCodingSessionUpdateSubscription(this.cachedClient);
		return this.cachedClient;
	}

	private ensureCodingSessionUpdateSubscription(client: CodexAppServerClient) {
		if (
			this.codingSessionUpdateUnsubscribe ||
			this.codingSessionUpdateHandlers.size === 0
		) {
			return;
		}
		this.codingSessionUpdateUnsubscribe = client.subscribe((notification) => {
			const update = readCodexCodingSessionUpdate(notification);
			if (!update) {
				return;
			}
			for (const handler of this.codingSessionUpdateHandlers) {
				handler(update);
			}
		});
	}
}

interface CodexActiveTurn {
	threadId: string;
	turnId: string;
	observedTurnIds: Set<string>;
}

function isCodexCompactionPrompt(prompt: string): boolean {
	return canonicalizePromptSlashCommand(prompt) === "/compact";
}

function readCodexCodingSessionUpdate(
	notification: CodexServerNotification,
): ProviderCodingSessionUpdate | undefined {
	const params = asRecord(notification.params);
	const sessionId = readThreadId(params);
	if (!sessionId) {
		return undefined;
	}

	if (notification.method === "thread/archived") {
		return {
			sessionId,
			lifecycleStatus: "archived",
		};
	}
	if (notification.method === "thread/unarchived") {
		return {
			sessionId,
			lifecycleStatus: "open",
		};
	}
	if (notification.method === "thread/name/updated") {
		const thread = asRecord(params?.thread);
		const title =
			typeof params?.name === "string"
				? params.name.trim()
				: typeof thread?.name === "string"
					? thread.name.trim()
					: "";
		if (!title) {
			return undefined;
		}
		return {
			sessionId,
			title,
		};
	}

	return undefined;
}

async function listCodexThreadMetadata(
	client: CodexAppServerClient,
	requested: Set<string>,
	lifecycleStatus: "open" | "archived",
): Promise<ProviderCodingSessionUpdate[]> {
	const updates: ProviderCodingSessionUpdate[] = [];
	const found = new Set<string>();
	let cursor: string | undefined;
	do {
		const response = await client.request<CodexThreadListResult>(
			"thread/list",
			{
				archived: lifecycleStatus === "archived",
				limit: CODEX_THREAD_LIST_PAGE_SIZE,
				sourceKinds: CODEX_THREAD_LIST_SOURCE_KINDS,
				...(cursor ? { cursor } : {}),
			},
		);
		for (const thread of response.data) {
			if (!requested.has(thread.id) || found.has(thread.id)) {
				continue;
			}
			found.add(thread.id);
			updates.push(readCodexThreadMetadata(thread, lifecycleStatus));
		}
		cursor =
			typeof response.nextCursor === "string" && response.nextCursor !== ""
				? response.nextCursor
				: undefined;
	} while (cursor && found.size < requested.size);
	return updates;
}

function readCodexThreadMetadata(
	thread: CodexThread,
	lifecycleStatus: "open" | "archived",
): ProviderCodingSessionUpdate {
	const title = thread.name?.trim();
	return {
		sessionId: thread.id,
		lifecycleStatus,
		...(title ? { title } : {}),
	};
}

function readThreadId(
	params: Record<string, unknown> | undefined,
): string | undefined {
	if (typeof params?.threadId === "string") {
		return params.threadId;
	}
	const thread = asRecord(params?.thread);
	return typeof thread?.id === "string" ? thread.id : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * Outclaw passes a provider-neutral instruction policy on every run. The Codex
 * adapter owns the Codex-specific wire shape that policy maps to:
 *
 * - `provider_default` is the Code Mode / provider-default coding-instruction
 *   path. Codex's own coding instructions, agent workspace `AGENTS.md`, and
 *   `CODEX_HOME/AGENTS.md` may all load; the adapter sets no `baseInstructions`
 *   and no project-doc suppression.
 * - `runtime_constructed` is Chat mode. The Outclaw system prompt becomes
 *   `baseInstructions`, and `config.project_doc_max_bytes = 0` suppresses the
 *   agent workspace `AGENTS.md` so it is not loaded a second time as a Codex
 *   project doc on top of the Outclaw prompt that already includes it.
 *   `CODEX_HOME/AGENTS.md` is allowed for the MVP.
 */
function applyInstructionPolicy(
	payload: Record<string, unknown>,
	policy: RuntimeInstructionPolicy | undefined,
): void {
	if (!policy || policy.mode !== "runtime_constructed") {
		return;
	}
	if (!policy.systemPrompt) {
		throw new Error(
			"Codex Chat instructionPolicy.mode is runtime_constructed but systemPrompt is empty",
		);
	}
	payload.baseInstructions = policy.systemPrompt;
	const existingConfig = (payload.config ?? {}) as Record<string, unknown>;
	payload.config = {
		...existingConfig,
		project_doc_max_bytes: 0,
	};
}

function applySessionEnv(
	payload: Record<string, unknown>,
	sessionEnv: Record<string, string> | undefined,
): void {
	if (!sessionEnv || Object.keys(sessionEnv).length === 0) {
		return;
	}
	const existingConfig = (payload.config ?? {}) as Record<string, unknown>;
	payload.config = {
		...existingConfig,
		shell_environment_policy: {
			set: sessionEnv,
		},
	};
}

function readApprovalPolicy(_mode: RuntimeExecutionMode | undefined): string {
	return CODEX_YOLO_APPROVAL_POLICY;
}

function readThreadSandbox(mode: RuntimeExecutionMode | undefined): string {
	return mode === "read_only"
		? CODEX_READ_ONLY_THREAD_SANDBOX
		: CODEX_YOLO_THREAD_SANDBOX;
}

function readTurnSandboxPolicy(
	mode: RuntimeExecutionMode | undefined,
): Record<string, unknown> {
	return mode === "read_only"
		? CODEX_READ_ONLY_TURN_SANDBOX_POLICY
		: CODEX_YOLO_TURN_SANDBOX_POLICY;
}

async function archiveEphemeralCodexThread(
	client: CodexAppServerClient,
	threadId: string,
): Promise<void> {
	try {
		await client.request("thread/archive", { threadId });
	} catch {
		// Ephemeral cleanup must not turn an otherwise completed title run into
		// a failed chat response. The thread remains recoverable if archival fails.
	}
}

function buildThreadStartParams(params: RunParams): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		approvalPolicy: readApprovalPolicy(params.executionMode),
		sandbox: readThreadSandbox(params.executionMode),
		experimentalRawEvents: true,
	};

	if (params.model && isCodexCompatibleModel(params.model)) {
		payload.model = params.model;
	}
	if (params.cwd) {
		payload.cwd = params.cwd;
	}
	applyInstructionPolicy(payload, params.instructionPolicy);
	applySessionEnv(payload, params.sessionEnv);
	if (params.ephemeral !== undefined) {
		payload.ephemeral = params.ephemeral;
	}
	if (params.serviceTier) {
		payload.serviceTier = params.serviceTier;
	}

	return payload;
}

function buildThreadResumeParams(params: RunParams): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		threadId: params.resume,
		approvalPolicy: readApprovalPolicy(params.executionMode),
		sandbox: readThreadSandbox(params.executionMode),
		experimentalRawEvents: true,
	};

	if (params.model && isCodexCompatibleModel(params.model)) {
		payload.model = params.model;
	}
	if (params.cwd) {
		payload.cwd = params.cwd;
	}
	applyInstructionPolicy(payload, params.instructionPolicy);
	applySessionEnv(payload, params.sessionEnv);
	if (params.serviceTier) {
		payload.serviceTier = params.serviceTier;
	}

	return payload;
}

function buildTurnStartParams(
	threadId: string,
	params: RunParams,
	input: CodexUserInput[],
): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		threadId,
		input,
		approvalPolicy: readApprovalPolicy(params.executionMode),
		sandboxPolicy: readTurnSandboxPolicy(params.executionMode),
		summary: DEFAULT_CODEX_REASONING_SUMMARY,
	};

	if (params.model && isCodexCompatibleModel(params.model)) {
		payload.model = params.model;
	}
	if (params.effort) {
		payload.effort = params.effort;
	}
	if (params.serviceTier) {
		payload.serviceTier = params.serviceTier;
	}

	return payload;
}

function isCodexCompatibleModel(model: string): boolean {
	// The runtime currently resolves model aliases against the Claude registry,
	// so Codex calls would otherwise receive a Claude-side identifier and fail.
	// Codex falls back to its own config default when `model` is omitted.
	return model.startsWith("gpt-") || model.startsWith("codex");
}

async function buildUserInput(
	client: CodexAppServerClient,
	params: RunParams,
): Promise<CodexUserInput[]> {
	const input: CodexUserInput[] = [];

	for (const image of params.images ?? []) {
		input.push({
			type: "localImage",
			path: image.path,
		});
	}

	input.push({
		type: "text",
		text: params.prompt,
		text_elements: [],
	});

	input.push(...(await resolveSkillInputs(client, params)));

	return input;
}

async function resolveSkillInputs(
	client: CodexAppServerClient,
	params: RunParams,
): Promise<CodexUserInput[]> {
	const skillNames = extractExplicitCodexSkillNames(params.prompt);
	if (skillNames.length === 0 || !params.cwd) {
		return [];
	}

	try {
		const skills = await requestCodexSkills(client, { cwd: params.cwd });
		const inputs: CodexUserInput[] = [];
		for (const skillName of skillNames) {
			const skill = findPreferredCodexSkillByName(skills, skillName);
			if (!skill) {
				continue;
			}
			inputs.push({
				type: "skill",
				name: skill.name,
				path: skill.path,
			});
		}
		return inputs;
	} catch {
		return [];
	}
}

async function requestCodexSkills(
	client: CodexAppServerClient,
	params: { cwd: string; forceReload?: boolean },
): Promise<CodexSkillMetadata[]> {
	const result = await client.request<CodexSkillsListResult>("skills/list", {
		cwds: [params.cwd],
		...(params.forceReload ? { forceReload: true } : {}),
	});
	return (
		result.data.find((entry) => entry.cwd === params.cwd)?.skills ??
		result.data[0]?.skills ??
		[]
	);
}

function extractExplicitCodexSkillNames(text: string): string[] {
	const names: string[] = [];
	const seen = new Set<string>();
	for (const match of text.matchAll(/(^|\s)\$([A-Za-z0-9_-]+)/g)) {
		const name = match[2];
		if (!name) {
			continue;
		}
		const key = name.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		names.push(name);
	}
	return names;
}

function findPreferredCodexSkillByName(
	skills: CodexSkillMetadata[],
	name: string,
): CodexSkillMetadata | undefined {
	const key = name.toLowerCase();
	return skills
		.filter((skill) => skill.enabled && skill.name.toLowerCase() === key)
		.sort(compareCodexSkillPriority)[0];
}

function compareCodexSkillPriority(
	left: Pick<CodexSkillMetadata, "name" | "path" | "scope">,
	right: Pick<CodexSkillMetadata, "name" | "path" | "scope">,
): number {
	const priority: Record<CodexSkillMetadata["scope"], number> = {
		repo: 0,
		user: 1,
		system: 2,
		admin: 3,
	};
	const scopeDelta = priority[left.scope] - priority[right.scope];
	if (scopeDelta !== 0) {
		return scopeDelta;
	}
	const nameDelta = left.name.localeCompare(right.name);
	return nameDelta !== 0 ? nameDelta : left.path.localeCompare(right.path);
}

function getCodexSkillDescription(
	skill: Pick<
		CodexSkillMetadata,
		"description" | "interface" | "shortDescription"
	>,
): string {
	return (
		skill.interface?.shortDescription ??
		skill.shortDescription ??
		skill.description ??
		""
	);
}
