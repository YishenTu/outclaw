import { join } from "node:path";
import { DEFAULT_EFFORT, type EffortLevel } from "../../../common/commands.ts";
import { OUTCLAW_NATIVE_TOOL_CATALOG } from "../../../common/native-tools.ts";
import {
	type AssistantMessageSegment,
	type DisplayImage,
	extractError,
	type ImageMediaType,
	type ImageRef,
	type UsageInfo,
} from "../../../common/protocol.ts";
import { calculateUsagePercentage } from "../../../common/usage.ts";
import { createOutclawNativePiTools } from "./native-tool-definitions.ts";
import {
	ensurePiProfile,
	getPiProfilePaths,
	type PiProfilePaths,
} from "./setup.ts";
import type {
	PiDriver,
	PiDriverEvent,
	PiDriverMessage,
	PiDriverModel,
	PiDriverRunParams,
	PiDriverSession,
	PiDriverSessionEntry,
} from "./types.ts";

type PiSdkModule = typeof import("@earendil-works/pi-coding-agent");
type SdkAgentSessionEvent =
	import("@earendil-works/pi-coding-agent").AgentSessionEvent;
type SdkResourceLoader =
	import("@earendil-works/pi-coding-agent").ResourceLoader;
type SdkSettingsManager =
	import("@earendil-works/pi-coding-agent").SettingsManager;
type SdkCreateAgentSessionOptions = NonNullable<
	Parameters<PiSdkModule["createAgentSession"]>[0]
>;
type SdkCustomTool = NonNullable<
	SdkCreateAgentSessionOptions["customTools"]
>[number];
type SdkSessionModel = NonNullable<SdkCreateAgentSessionOptions["model"]>;
type SdkThinkingLevel = NonNullable<
	SdkCreateAgentSessionOptions["thinkingLevel"]
>;
type SdkPromptOptions = NonNullable<
	Parameters<
		import("@earendil-works/pi-coding-agent").AgentSession["prompt"]
	>[1]
>;
type SdkImageContent = NonNullable<SdkPromptOptions["images"]>[number];

const PI_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const PI_READ_ONLY_BUILTIN_TOOL_NAMES = ["read", "grep", "find", "ls"] as const;
const READ_ONLY_OUTCLAW_NATIVE_TOOL_NAMES = OUTCLAW_NATIVE_TOOL_CATALOG.filter(
	(tool) =>
		hasReadOnlySafetyClass(tool.safetyClasses) ||
		tool.modes.some((mode) => hasReadOnlySafetyClass(mode.safetyClasses)),
).map((tool) => tool.name);

interface PiDriverOptions {
	paths?: PiProfilePaths;
	loadSdk?: () => Promise<PiSdkModule>;
	now?: () => number;
}

export function createPiDriver(options: PiDriverOptions = {}): PiDriver {
	return new PiDriverImpl(options);
}

class PiDriverImpl implements PiDriver {
	private readonly paths: PiProfilePaths;
	private readonly loadSdk: () => Promise<PiSdkModule>;
	private readonly now: () => number;
	private readonly activeSessions = new Set<SdkSessionLike>();
	private sdk: PiSdkModule | undefined;

	constructor(options: PiDriverOptions) {
		this.paths = options.paths ?? getPiProfilePaths();
		this.loadSdk =
			options.loadSdk ??
			(async () => await import("@earendil-works/pi-coding-agent"));
		this.now = options.now ?? Date.now;
	}

	async *run(params: PiDriverRunParams): AsyncIterable<PiDriverEvent> {
		const sdk = await this.getSdk();
		ensurePiProfile(this.paths);
		const cwd = params.cwd ?? process.cwd();
		const sessionDir = this.sessionDir();
		if (!params.resumeSessionId && !params.model) {
			throw new Error("Pi fresh sessions require an explicit model");
		}
		const sessionManager = params.resumeSessionId
			? sdk.SessionManager.open(
					(await this.findSessionInfo(params.resumeSessionId)).path,
					sessionDir,
					cwd,
				)
			: params.ephemeral
				? sdk.SessionManager.inMemory(cwd)
				: sdk.SessionManager.create(cwd, sessionDir, {
						...(params.preferredSessionId
							? { id: params.preferredSessionId }
							: {}),
					});
		const authStorage = sdk.AuthStorage.create(this.paths.sharedAuthFile);
		const modelRegistry = sdk.ModelRegistry.inMemory(authStorage);
		const model = params.model
			? findSdkModel(modelRegistry.getAll(), params.model)
			: undefined;
		if (params.model && !model) {
			throw new Error(`Pi model ${params.model} is not configured`);
		}
		const settingsManager = sdk.SettingsManager.inMemory({
			compaction: { enabled: true },
		});
		const resourceLoader = createNoDiscoveryResourceLoader(sdk, {
			cwd,
			agentDir: this.paths.agentDir,
			extensionDir: this.paths.extensionDir,
			settingsManager,
			skillRootDir: params.skillRootDir,
			systemPrompt:
				params.instructionMode === "runtime_constructed"
					? params.systemPrompt
					: undefined,
		});
		await resourceLoader.reload();
		const customTools = createCustomTools(sdk, cwd, params);
		const { session, modelFallbackMessage } = await sdk.createAgentSession({
			cwd,
			agentDir: this.paths.agentDir,
			authStorage,
			modelRegistry,
			...(model ? { model } : {}),
			...(params.effort
				? { thinkingLevel: normalizeThinkingLevel(params.effort) }
				: {}),
			resourceLoader,
			settingsManager,
			sessionManager,
			...(params.serviceTier !== undefined
				? { sessionStartEvent: createOutclawSessionStartEvent(params) }
				: {}),
			...(customTools ? { customTools } : {}),
			...(params.readOnly ? { tools: readOnlyToolAllowlist(params) } : {}),
		});
		if (modelFallbackMessage) {
			session.dispose();
			throw new Error(
				`Pi could not inherit the persisted model: ${modelFallbackMessage}`,
			);
		}
		this.activeSessions.add(session);
		try {
			const startedAt = this.now();
			yield { type: "session_started", sessionId: session.sessionId };

			const queue = new AsyncEventQueue<PiDriverEvent>();
			let failed = false;
			let abortRequested = false;
			let abortCompletion: Promise<void> | undefined;
			let latestUsage: UsageInfo | undefined;
			let latestCostUsd: number | undefined;
			const unsubscribe = session.subscribe((event) => {
				for (const driverEvent of projectSessionEvent(session, event)) {
					queue.push(driverEvent);
				}
				const usageSnapshot = projectSessionUsage(session, event, model);
				if (usageSnapshot) {
					latestUsage = usageSnapshot.usage;
					latestCostUsd = usageSnapshot.costUsd;
					queue.push({
						type: "usage",
						usage: usageSnapshot.usage,
						sessionId: session.sessionId,
					});
				}
			});
			const abort = () => {
				if (abortRequested) {
					return;
				}
				abortRequested = true;
				abortCompletion = session
					.abort()
					.then(() =>
						queue.push({
							type: "turn_aborted",
							sessionId: session.sessionId,
							timestamp: this.now(),
						}),
					)
					.catch((err) => {
						failed = true;
						queue.push({ type: "error", message: extractError(err) });
					});
			};
			if (params.abortSignal?.aborted) {
				abort();
			}
			params.abortSignal?.addEventListener("abort", abort, { once: true });

			const prompt = (async () => {
				try {
					const images = await loadPromptImages(params.images);
					await session.prompt(params.prompt, {
						expandPromptTemplates: false,
						...(images ? { images } : {}),
					});
				} catch (err) {
					if (abortRequested) {
						return;
					}
					failed = true;
					queue.push({ type: "error", message: extractError(err) });
				} finally {
					unsubscribe();
					params.abortSignal?.removeEventListener("abort", abort);
					await abortCompletion;
					queue.close();
				}
			})();

			for await (const event of queue) {
				yield event;
			}
			await prompt;

			if (!failed && !abortRequested) {
				const finalUsage = projectSessionStatsUsage(session, model);
				const usage = finalUsage?.usage ?? latestUsage;
				const costUsd = finalUsage?.costUsd ?? latestCostUsd;
				yield {
					type: "done",
					sessionId: session.sessionId,
					durationMs: this.now() - startedAt,
					timestamp: this.now(),
					...(costUsd !== undefined ? { costUsd } : {}),
					...(usage ? { usage } : {}),
				};
			}
		} finally {
			this.activeSessions.delete(session);
			session.dispose();
		}
	}

	async readSession(sessionId: string): Promise<PiDriverSession> {
		const sdk = await this.getSdk();
		const sessionInfo = await this.findSessionInfo(sessionId);
		const manager = sdk.SessionManager.open(
			sessionInfo.path,
			this.sessionDir(),
		);
		const entries = readSessionEntries(manager);
		const projectedEntries = entries
			.map(projectSessionEntry)
			.filter((entry): entry is PiDriverSessionEntry => entry !== undefined);
		return {
			id: manager.getSessionId(),
			messages: projectedEntries
				.filter(
					(
						entry,
					): entry is Extract<PiDriverSessionEntry, { type: "message" }> =>
						entry.type === "message",
				)
				.map((entry) => entry.message),
			entries: projectedEntries,
		};
	}

	async listModels(): Promise<PiDriverModel[]> {
		const sdk = await this.getSdk();
		const authStorage = sdk.AuthStorage.create(this.paths.sharedAuthFile);
		const modelRegistry = sdk.ModelRegistry.inMemory(authStorage);
		return modelRegistry.getAvailable().map(projectSdkModel);
	}

	dispose(): void {
		for (const session of this.activeSessions) {
			session.dispose();
		}
		this.activeSessions.clear();
	}

	private async getSdk(): Promise<PiSdkModule> {
		configurePiSdkEnvironment(this.paths);
		this.sdk ??= await this.loadSdk();
		return this.sdk;
	}

	private sessionDir(): string {
		return join(this.paths.agentDir, "sessions");
	}

	private async findSessionInfo(sessionId: string): Promise<SdkSessionInfo> {
		const sdk = await this.getSdk();
		const sessions = await sdk.SessionManager.listAll(this.sessionDir());
		const found = sessions.find((session) => session.id === sessionId);
		if (!found) {
			throw new Error(`Pi session ${sessionId} was not found`);
		}
		return found;
	}
}

function createOutclawSessionStartEvent(params: PiDriverRunParams): NonNullable<
	SdkCreateAgentSessionOptions["sessionStartEvent"]
> & {
	outclaw?: { serviceTier?: string };
} {
	return {
		type: "session_start",
		reason: params.resumeSessionId ? "resume" : "startup",
		outclaw: {
			serviceTier: params.serviceTier,
		},
	};
}

function readOnlyToolAllowlist(params: PiDriverRunParams): string[] {
	return [
		...PI_READ_ONLY_BUILTIN_TOOL_NAMES,
		...(params.nativeToolHost ? READ_ONLY_OUTCLAW_NATIVE_TOOL_NAMES : []),
	];
}

function hasReadOnlySafetyClass(safetyClasses: readonly string[]): boolean {
	return safetyClasses.includes("read-only");
}

function createCustomTools(
	sdk: PiSdkModule,
	cwd: string,
	params: PiDriverRunParams,
): SdkCustomTool[] | undefined {
	const customTools: SdkCustomTool[] = [];
	if (params.sessionEnv) {
		customTools.push(createSessionEnvBashTool(sdk, cwd, params.sessionEnv));
	}
	if (params.nativeToolHost) {
		customTools.push(...createOutclawNativePiTools(sdk, params.nativeToolHost));
	}
	return customTools.length > 0 ? customTools : undefined;
}

function configurePiSdkEnvironment(paths: PiProfilePaths): void {
	process.env[PI_AGENT_DIR_ENV] = paths.agentDir;
}

interface SdkSessionLike {
	sessionId: string;
	dispose(): void;
	prompt(text: string, options?: SdkPromptOptions): Promise<void>;
	abort(): Promise<void>;
	subscribe(listener: (event: SdkAgentSessionEvent) => void): () => void;
	getSessionStats?(): unknown;
}

interface SdkSessionInfo {
	id: string;
	path: string;
}

function createNoDiscoveryResourceLoader(
	sdk: PiSdkModule,
	params: {
		agentDir: string;
		cwd: string;
		extensionDir: string;
		settingsManager: SdkSettingsManager;
		skillRootDir: string | undefined;
		systemPrompt: string | undefined;
	},
): SdkResourceLoader {
	const resourceLoader = new sdk.DefaultResourceLoader({
		cwd: params.cwd,
		agentDir: params.agentDir,
		settingsManager: params.settingsManager,
		additionalExtensionPaths: [params.extensionDir],
		additionalSkillPaths: params.skillRootDir ? [params.skillRootDir] : [],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: params.systemPrompt,
	});
	return resourceLoader;
}

function createSessionEnvBashTool(
	sdk: PiSdkModule,
	cwd: string,
	sessionEnv: Record<string, string>,
): SdkCustomTool {
	return sdk.createBashToolDefinition(cwd, {
		spawnHook: (context) => ({
			command: context.command,
			cwd: context.cwd,
			env: {
				...context.env,
				...sessionEnv,
			},
		}),
	}) as SdkCustomTool;
}

async function loadPromptImages(
	images: ImageRef[] | undefined,
): Promise<SdkImageContent[] | undefined> {
	if (!images || images.length === 0) {
		return undefined;
	}
	return Promise.all(
		images.map(async (image) => ({
			type: "image" as const,
			data: Buffer.from(await Bun.file(image.path).arrayBuffer()).toString(
				"base64",
			),
			mimeType: image.mediaType,
		})),
	);
}

function projectSessionEvent(
	session: SdkSessionLike,
	event: SdkAgentSessionEvent,
): PiDriverEvent[] {
	switch (event.type) {
		case "message_update": {
			const assistantEvent = event.assistantMessageEvent;
			if (assistantEvent.type === "text_delta") {
				return [
					{
						type: "text_delta",
						text: assistantEvent.delta,
						sessionId: session.sessionId,
						timestamp: event.message.timestamp,
					},
				];
			}
			if (assistantEvent.type === "thinking_delta") {
				return [
					{
						type: "thinking_delta",
						text: assistantEvent.delta,
						blockId: String(assistantEvent.contentIndex),
						sessionId: session.sessionId,
						timestamp: event.message.timestamp,
					},
				];
			}
			return [];
		}
		case "tool_execution_start":
			return [
				{
					type: "tool_call_started",
					callId: event.toolCallId,
					toolKind: event.toolName,
					details: detailsFromRecord(event.args),
					sessionId: session.sessionId,
				},
			];
		case "tool_execution_end":
			return [
				{
					type: "tool_call_completed",
					callId: event.toolCallId,
					toolKind: event.toolName,
					status: event.isError ? "error" : "success",
					details: detailsFromRecord(event.result),
					sessionId: session.sessionId,
				},
			];
		case "compaction_start":
			return [{ type: "compaction_started", sessionId: session.sessionId }];
		case "compaction_end":
			return [{ type: "compaction_finished", sessionId: session.sessionId }];
		case "auto_retry_start":
			return [
				{
					type: "status",
					message: `Pi retry ${event.attempt}/${event.maxAttempts}: ${event.errorMessage}`,
					sessionId: session.sessionId,
				},
			];
		case "auto_retry_end":
			return event.success
				? []
				: [
						{
							type: "error",
							message: event.finalError ?? "Pi retry failed",
							sessionId: session.sessionId,
						},
					];
		default:
			return [];
	}
}

interface PiUsageSnapshot {
	usage: UsageInfo;
	costUsd?: number;
}

function projectSessionUsage(
	session: SdkSessionLike,
	event: SdkAgentSessionEvent,
	model: SdkModel | undefined,
): PiUsageSnapshot | undefined {
	if (event.type !== "message_end") {
		return undefined;
	}
	const message = asRecord((event as { message?: unknown }).message);
	if (message?.role !== "assistant") {
		return undefined;
	}
	if (message.stopReason === "aborted" || message.stopReason === "error") {
		return undefined;
	}

	return (
		projectSessionStatsUsage(session, model) ??
		projectAssistantMessageUsage(message, model)
	);
}

function projectSessionStatsUsage(
	session: SdkSessionLike,
	model: SdkModel | undefined,
): PiUsageSnapshot | undefined {
	const stats = asRecord(session.getSessionStats?.());
	if (!stats) {
		return undefined;
	}
	const tokens = asRecord(stats?.tokens);
	if (!tokens) {
		return undefined;
	}

	const inputTokens = readNumber(tokens.input) ?? 0;
	const outputTokens = readNumber(tokens.output) ?? 0;
	const cacheReadTokens = readNumber(tokens.cacheRead) ?? 0;
	const cacheCreationTokens = readNumber(tokens.cacheWrite) ?? 0;
	const contextUsage = asRecord(stats.contextUsage);
	const contextUsageTokens =
		contextUsage && "tokens" in contextUsage
			? readNumberOrNull(contextUsage.tokens)
			: undefined;
	if (contextUsageTokens === null) {
		return undefined;
	}
	const contextTokens =
		contextUsageTokens ??
		readNumber(tokens.total) ??
		inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
	const contextWindow =
		readPositiveNumber(contextUsage?.contextWindow) ??
		readPositiveNumber(model?.contextWindow) ??
		0;
	const maxOutputTokens = readPositiveNumber(model?.maxTokens) ?? 0;
	const percentage = readPercentage(contextUsage?.percent);

	return {
		usage: {
			inputTokens,
			outputTokens,
			cacheCreationTokens,
			cacheReadTokens,
			contextWindow,
			maxOutputTokens,
			contextTokens,
			percentage:
				percentage ?? calculateUsagePercentage(contextTokens, contextWindow),
		},
		...withCostUsd(readNumber(stats.cost)),
	};
}

function projectAssistantMessageUsage(
	message: Record<string, unknown>,
	model: SdkModel | undefined,
): PiUsageSnapshot | undefined {
	const usage = asRecord(message.usage);
	if (!usage) {
		return undefined;
	}

	const inputTokens = readNumber(usage.input) ?? 0;
	const outputTokens = readNumber(usage.output) ?? 0;
	const cacheReadTokens = readNumber(usage.cacheRead) ?? 0;
	const cacheCreationTokens = readNumber(usage.cacheWrite) ?? 0;
	const contextTokens =
		readNumber(usage.totalTokens) ??
		inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
	const contextWindow = readPositiveNumber(model?.contextWindow) ?? 0;
	const maxOutputTokens = readPositiveNumber(model?.maxTokens) ?? 0;
	const cost = asRecord(usage.cost);

	return {
		usage: {
			inputTokens,
			outputTokens,
			cacheCreationTokens,
			cacheReadTokens,
			contextWindow,
			maxOutputTokens,
			contextTokens,
			percentage: calculateUsagePercentage(contextTokens, contextWindow),
		},
		...withCostUsd(readNumber(cost?.total)),
	};
}

function readSessionEntries(manager: unknown): unknown[] {
	const reader = manager as {
		getBranch?: () => unknown;
		getEntries: () => unknown;
	};
	const branch = reader.getBranch?.();
	if (Array.isArray(branch)) {
		return branch;
	}
	const entries = reader.getEntries();
	return Array.isArray(entries) ? entries : [];
}

function projectSessionEntry(entry: unknown): PiDriverSessionEntry | undefined {
	const record = asRecord(entry);
	if (!record) {
		return undefined;
	}
	if (record.type === "message") {
		const message = projectSessionMessageEntry(record);
		return message ? { type: "message", message } : undefined;
	}
	if (record.type === "compaction") {
		return projectCompactionEntry(record);
	}
	return undefined;
}

function projectCompactionEntry(
	entry: Record<string, unknown>,
): PiDriverSessionEntry {
	const timestamp = parseTimestamp(entry.timestamp);
	const tokensBefore = readNumber(entry.tokensBefore);
	return {
		type: "compaction" as const,
		...(timestamp !== undefined ? { timestamp } : {}),
		...(tokensBefore !== undefined ? { tokensBefore } : {}),
	};
}

function projectSessionMessageEntry(entry: {
	timestamp?: unknown;
	message?: unknown;
}): PiDriverMessage | undefined {
	if (!isRecord(entry.message)) {
		return undefined;
	}
	const message = entry.message as SdkMessage;
	const timestamp =
		typeof message.timestamp === "number"
			? message.timestamp
			: parseTimestamp(entry.timestamp);
	if (message.role === "user") {
		const content = extractTextContent(message.content);
		const images = extractImageContent(message.content);
		return {
			role: "user" as const,
			content,
			...(images ? { images } : {}),
			...(timestamp !== undefined ? { timestamp } : {}),
		};
	}
	if (message.role === "assistant") {
		const segments = extractAssistantSegments(message.content);
		return {
			role: "assistant" as const,
			segments,
			...(timestamp !== undefined ? { timestamp } : {}),
		};
	}
	return undefined;
}

type SdkMessage =
	| {
			role: "user";
			content: unknown;
			timestamp?: number;
	  }
	| {
			role: "assistant";
			content: unknown;
			timestamp?: number;
	  }
	| {
			role: string;
			content?: unknown;
			timestamp?: number;
	  };

function extractTextContent(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((part) =>
			isRecord(part) && part.type === "text" && typeof part.text === "string"
				? part.text
				: "",
		)
		.join("");
}

function extractImageContent(content: unknown): DisplayImage[] | undefined {
	if (!Array.isArray(content)) {
		return undefined;
	}
	const images: DisplayImage[] = [];
	for (const part of content) {
		if (!isRecord(part) || part.type !== "image") {
			continue;
		}
		if (typeof part.data !== "string" || !isImageMediaType(part.mimeType)) {
			continue;
		}
		images.push({
			kind: "inline",
			base64: part.data,
			mediaType: part.mimeType,
		});
	}
	return images.length > 0 ? images : undefined;
}

function extractAssistantSegments(content: unknown): AssistantMessageSegment[] {
	if (!Array.isArray(content)) {
		return [];
	}
	const segments: AssistantMessageSegment[] = [];
	for (const part of content) {
		if (!isRecord(part)) {
			continue;
		}
		if (part.type === "text" && typeof part.text === "string") {
			segments.push({ type: "text", text: part.text });
			continue;
		}
		if (part.type === "thinking" && typeof part.thinking === "string") {
			segments.push({ type: "thinking", text: part.thinking });
		}
	}
	return segments;
}

function projectSdkModel(model: SdkModel): PiDriverModel {
	const supportedReasoningEfforts = supportedOutclawEfforts(model);
	const modelId = `${model.provider}/${model.id}`;
	const defaultReasoningEffort = supportedReasoningEfforts.includes(
		DEFAULT_EFFORT,
	)
		? DEFAULT_EFFORT
		: (supportedReasoningEfforts[0] ?? DEFAULT_EFFORT);
	return {
		id: modelId,
		model: modelId,
		displayName: model.name,
		description: `${model.provider} ${model.name}`,
		isDefault: false,
		defaultReasoningEffort,
		supportedReasoningEfforts,
		contextWindow: model.contextWindow,
	};
}

interface SdkModel {
	id: string;
	name: string;
	provider: string;
	reasoning: boolean;
	thinkingLevelMap?: Record<string, string | null | undefined>;
	contextWindow?: number;
	maxTokens?: number;
}

function findSdkModel(
	models: unknown[],
	modelId: string,
): SdkSessionModel | undefined {
	for (const model of models) {
		if (!isSdkModel(model)) {
			continue;
		}
		if (
			`${model.provider}/${model.id}` === modelId ||
			`${model.provider}:${model.id}` === modelId
		) {
			return model as SdkSessionModel;
		}
	}
	return undefined;
}

function supportedOutclawEfforts(model: SdkModel): EffortLevel[] {
	if (!model.reasoning) {
		return [];
	}
	const levels = ["minimal", "low", "medium", "high", "xhigh"];
	const efforts = new Set<EffortLevel>();
	if (!model.thinkingLevelMap) {
		for (const level of levels) {
			addOutclawEffort(efforts, level);
		}
		return [...efforts];
	}
	for (const level of levels) {
		if (model.thinkingLevelMap[level] !== null) {
			addOutclawEffort(efforts, level);
		}
	}
	return [...efforts];
}

function addOutclawEffort(efforts: Set<EffortLevel>, level: string) {
	const effort = outclawEffortForPiThinkingLevel(level);
	if (effort) {
		efforts.add(effort);
	}
}

function outclawEffortForPiThinkingLevel(
	level: string,
): EffortLevel | undefined {
	switch (level) {
		case "minimal":
		case "low":
			return "low";
		case "medium":
			return "medium";
		case "high":
			return "high";
		case "xhigh":
			return "xhigh";
		default:
			return undefined;
	}
}

function normalizeThinkingLevel(effort: string): SdkThinkingLevel {
	switch (effort) {
		case "off":
		case "minimal":
		case "low":
		case "medium":
		case "high":
		case "xhigh":
			return effort as SdkThinkingLevel;
		default:
			return "medium" as SdkThinkingLevel;
	}
}

function detailsFromRecord(value: unknown) {
	if (!isRecord(value)) {
		return undefined;
	}
	return Object.entries(value)
		.filter((entry): entry is [string, string | number | boolean] =>
			["string", "number", "boolean"].includes(typeof entry[1]),
		)
		.map(([label, detail]) => ({
			label,
			value: String(detail),
		}));
}

function isSdkModel(value: unknown): value is SdkModel {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.name === "string" &&
		typeof value.provider === "string" &&
		typeof value.reasoning === "boolean"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

function parseTimestamp(value: unknown): number | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isImageMediaType(value: unknown): value is ImageMediaType {
	return (
		value === "image/jpeg" ||
		value === "image/png" ||
		value === "image/gif" ||
		value === "image/webp"
	);
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function readNumberOrNull(value: unknown): number | null | undefined {
	if (value === null) {
		return null;
	}
	return readNumber(value);
}

function readPositiveNumber(value: unknown): number | undefined {
	const number = readNumber(value);
	return number !== undefined && number > 0 ? number : undefined;
}

function readPercentage(value: unknown): number | undefined {
	const number = readNumber(value);
	if (number === undefined) {
		return undefined;
	}
	return Math.min(100, Math.max(0, number));
}

function withCostUsd(costUsd: number | undefined): { costUsd?: number } {
	return costUsd !== undefined ? { costUsd } : {};
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
	private values: T[] = [];
	private waiters: Array<(result: IteratorResult<T>) => void> = [];
	private closed = false;

	push(value: T) {
		const waiter = this.waiters.shift();
		if (waiter) {
			waiter({ done: false, value });
			return;
		}
		this.values.push(value);
	}

	close() {
		this.closed = true;
		for (const waiter of this.waiters.splice(0)) {
			waiter({ done: true, value: undefined });
		}
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return {
			next: () => this.next(),
		};
	}

	private next(): Promise<IteratorResult<T>> {
		const value = this.values.shift();
		if (value !== undefined) {
			return Promise.resolve({ done: false, value });
		}
		if (this.closed) {
			return Promise.resolve({ done: true, value: undefined });
		}
		return new Promise((resolve) => {
			this.waiters.push(resolve);
		});
	}
}
