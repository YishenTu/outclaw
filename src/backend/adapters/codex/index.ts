import { readFile } from "node:fs/promises";
import {
	type CodingSessionEvent,
	extractError,
	type Facade,
	type FacadeEvent,
	type ProviderModelInfo,
	type ProviderSkillInfo,
	type RunParams,
} from "../../../common/protocol.ts";
import {
	type CodexAppServerClientOptions,
	createCodexAppServerClient,
} from "./app-server-client.ts";
import { CodexNotificationQueue } from "./notification-queue.ts";
import {
	normalizeCodexJsonlEvents,
	normalizeCodexTurnNotifications,
} from "./stream-normalizer.ts";
import type {
	CodexAppServerClient,
	CodexModelListResponse,
	CodexSkillMetadata,
	CodexSkillsListResult,
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
const CODEX_CODE_MODE_APPROVAL_POLICY = "never";
const CODEX_CODE_MODE_THREAD_SANDBOX = "danger-full-access";
const CODEX_CODE_MODE_TURN_SANDBOX_POLICY = { type: "dangerFullAccess" };

export class CodexAdapter implements Facade {
	readonly providerId = "codex";
	private readonly injectedClient?: CodexAppServerClient;
	private readonly appServerOptions?: CodexAppServerClientOptions;
	private cachedClient?: CodexAppServerClient;
	private readonly activeTurns = new Map<string, CodexActiveTurn>();

	constructor(options: CodexAdapterOptions = {}) {
		this.injectedClient = options.client;
		this.appServerOptions = options.appServer;
	}

	async dispose(): Promise<void> {
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
					model: entry.model,
					displayName: entry.displayName,
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
		const client = await this.loadClient();
		await client.initialize();
		const thread = await client.request<CodexThreadResumeResult>(
			"thread/resume",
			{ threadId: sessionId },
		);
		if (!thread.thread.path) {
			return [];
		}
		const content = await readFile(thread.thread.path, "utf8");
		return normalizeCodexJsonlEvents(content, { sessionId: thread.thread.id });
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

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		const startedAtMs = Date.now();
		const client = await this.loadClient();
		const queue = new CodexNotificationQueue();
		const unsubscribe = client.subscribe((notification) => {
			queue.push(notification);
		});
		let threadId: string | undefined;
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
			yield {
				type: "session_initialized",
				sessionId: threadId,
			};

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
			}) as AsyncIterable<FacadeEvent>;
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
		}
	}

	private async loadClient(): Promise<CodexAppServerClient> {
		if (this.injectedClient) {
			return this.injectedClient;
		}
		this.cachedClient ??= createCodexAppServerClient(this.appServerOptions);
		return this.cachedClient;
	}
}

interface CodexActiveTurn {
	threadId: string;
	turnId: string;
	observedTurnIds: Set<string>;
}

function buildThreadStartParams(params: RunParams): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		approvalPolicy: CODEX_CODE_MODE_APPROVAL_POLICY,
		sandbox: CODEX_CODE_MODE_THREAD_SANDBOX,
		experimentalRawEvents: true,
	};

	if (params.model && isCodexCompatibleModel(params.model)) {
		payload.model = params.model;
	}
	if (params.cwd) {
		payload.cwd = params.cwd;
	}
	if (params.systemPrompt) {
		payload.baseInstructions = params.systemPrompt;
	}
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
		approvalPolicy: CODEX_CODE_MODE_APPROVAL_POLICY,
		sandbox: CODEX_CODE_MODE_THREAD_SANDBOX,
		experimentalRawEvents: true,
	};

	if (params.model && isCodexCompatibleModel(params.model)) {
		payload.model = params.model;
	}
	if (params.cwd) {
		payload.cwd = params.cwd;
	}
	if (params.systemPrompt) {
		payload.baseInstructions = params.systemPrompt;
	}
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
		approvalPolicy: CODEX_CODE_MODE_APPROVAL_POLICY,
		sandboxPolicy: CODEX_CODE_MODE_TURN_SANDBOX_POLICY,
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
