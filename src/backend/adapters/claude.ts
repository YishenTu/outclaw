import { unlinkSync } from "node:fs";
import { contextWindowForResolvedModel } from "../../common/models.ts";
import {
	extractError,
	type Facade,
	type FacadeEvent,
	type ImageMediaType,
	type RunParams,
	type SkillInfo,
	type UsageInfo,
} from "../../common/protocol.ts";
import { buildPromptWithReplyContext } from "../../common/reply-context.ts";
import {
	calculateUsagePercentage,
	recalculateUsageForContextWindow,
} from "../../common/usage.ts";
import {
	type LoadClaudeHistory,
	readClaudeHistory,
	readClaudeTranscript,
} from "./claude-history.ts";

/** Structural subset of the SDK's SDKUserMessage — avoids importing the SDK at module level. */
interface SdkUserMessage {
	type: "user";
	message: MessageParam;
	parent_tool_use_id: string | null;
}

type ContentBlockParam =
	| {
			type: "text";
			text: string;
	  }
	| {
			type: "image";
			source: {
				type: "base64";
				data: string;
				media_type: ImageMediaType;
			};
	  };

interface MessageParam {
	role: "user";
	content: string | ContentBlockParam[];
}

type SdkQueryFn = (params: {
	prompt: string | AsyncIterable<SdkUserMessage>;
	// biome-ignore lint/suspicious/noExplicitAny: SDK options are open-ended
	options?: any;
	// biome-ignore lint/suspicious/noExplicitAny: SDK events are discriminated at runtime
}) => AsyncIterable<any> & {
	supportedCommands(): Promise<{ name: string; description: string }[]>;
};

interface ClaudeAdapterSdk {
	query: SdkQueryFn;
	getSessionMessages: LoadClaudeHistory;
}

interface ClaudeAdapterOptions {
	autoCompact?: boolean;
	claudeProjectsDir?: string;
	sdk?: ClaudeAdapterSdk;
	sleep?: (ms: number) => Promise<void>;
	unlinkFile?: (path: string) => void;
}

interface ClaudeModelUsageEntry {
	contextWindow?: number;
	maxOutputTokens?: number;
}

interface ClaudeMessageUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
}

interface ClaudeModelSignature {
	family: "haiku" | "sonnet" | "opus";
	is1M: boolean;
}

function extractAssistantUsage(
	event: {
		message?: {
			usage?: ClaudeMessageUsage;
		};
	},
	resolvedModel: string | undefined,
): UsageInfo | undefined {
	const usage = event.message?.usage;
	if (!usage) return undefined;

	const inputTokens = usage.input_tokens ?? 0;
	const outputTokens = usage.output_tokens ?? 0;
	const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
	const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
	const contextTokens = inputTokens + cacheCreationTokens + cacheReadTokens;
	const contextWindow =
		contextWindowForResolvedModel(resolvedModel ?? "") ?? 200_000;
	const maxOutputTokens = 32_000;

	return {
		inputTokens,
		outputTokens,
		cacheCreationTokens,
		cacheReadTokens,
		contextWindow,
		maxOutputTokens,
		contextTokens,
		percentage: calculateUsagePercentage(contextTokens, contextWindow),
	};
}

function applyAuthoritativeModelUsage(
	usage: UsageInfo | undefined,
	event: {
		modelUsage?: Record<string, ClaudeModelUsageEntry>;
	},
	intendedModel: string | undefined,
): UsageInfo | undefined {
	if (!usage) return undefined;

	const selected = selectModelUsageEntry(event.modelUsage, intendedModel);
	if (!selected) {
		return usage;
	}

	const contextWindow = selected.contextWindow ?? usage.contextWindow;
	const maxOutputTokens = selected.maxOutputTokens ?? usage.maxOutputTokens;

	return {
		...recalculateUsageForContextWindow(usage, contextWindow),
		maxOutputTokens,
	};
}

function selectModelUsageEntry(
	modelUsage: Record<string, ClaudeModelUsageEntry> | undefined,
	intendedModel: string | undefined,
): ClaudeModelUsageEntry | undefined {
	if (!modelUsage) return undefined;

	const entries = Object.entries(modelUsage).flatMap(([model, usage]) =>
		typeof usage?.contextWindow === "number" && usage.contextWindow > 0
			? [{ model, usage }]
			: [],
	);

	if (entries.length === 0) return undefined;
	if (entries.length === 1) return entries[0]?.usage;
	if (!intendedModel) return undefined;

	const exactMatches = entries.filter((entry) => entry.model === intendedModel);
	if (exactMatches.length === 1) {
		return exactMatches[0]?.usage;
	}

	const intendedSignature = getBuiltInModelSignature(intendedModel);
	if (!intendedSignature) return undefined;

	const signatureMatches = entries.filter((entry) => {
		const entrySignature = getModelUsageSignature(entry.model);
		return (
			entrySignature?.family === intendedSignature.family &&
			entrySignature.is1M === intendedSignature.is1M
		);
	});

	return signatureMatches.length === 1 ? signatureMatches[0]?.usage : undefined;
}

function getBuiltInModelSignature(
	model: string,
): ClaudeModelSignature | undefined {
	const normalized = model.trim().toLowerCase();
	if (normalized === "haiku") {
		return { family: "haiku", is1M: false };
	}
	if (normalized === "sonnet" || normalized === "sonnet[1m]") {
		return { family: "sonnet", is1M: normalized.endsWith("[1m]") };
	}
	if (normalized === "opus" || normalized === "opus[1m]") {
		return { family: "opus", is1M: normalized.endsWith("[1m]") };
	}
	if (normalized.includes("haiku")) {
		return { family: "haiku", is1M: false };
	}
	if (normalized.includes("sonnet")) {
		return { family: "sonnet", is1M: normalized.endsWith("[1m]") };
	}
	if (normalized.includes("opus")) {
		return { family: "opus", is1M: normalized.endsWith("[1m]") };
	}
	return undefined;
}

function getModelUsageSignature(
	model: string,
): ClaudeModelSignature | undefined {
	const normalized = model.trim().toLowerCase();
	if (normalized.includes("haiku")) {
		return { family: "haiku", is1M: false };
	}
	if (normalized.includes("sonnet")) {
		return { family: "sonnet", is1M: normalized.endsWith("[1m]") };
	}
	if (normalized.includes("opus")) {
		return { family: "opus", is1M: normalized.endsWith("[1m]") };
	}
	return undefined;
}

export class ClaudeAdapter implements Facade {
	readonly providerId = "claude";
	private skills: SkillInfo[] = [];
	private readonly sdk?: ClaudeAdapterSdk;
	private cachedSdk?: ClaudeAdapterSdk;
	private readonly claudeProjectsDir?: string;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly unlinkFile: (path: string) => void;

	readonly autoCompact: boolean;

	constructor(options: ClaudeAdapterOptions = {}) {
		this.autoCompact = options.autoCompact ?? true;
		this.sdk = options.sdk;
		this.claudeProjectsDir = options.claudeProjectsDir;
		this.sleep = options.sleep ?? waitFor;
		this.unlinkFile = options.unlinkFile ?? unlinkSync;
	}

	async getSkills(cwd?: string): Promise<SkillInfo[]> {
		if (this.skills.length > 0) {
			return this.skills;
		}
		return this.probeSkills(cwd);
	}

	async readHistory(sessionId: string) {
		const sdk = await this.loadSdk();
		return readClaudeHistory({
			sessionId,
			loadHistory: sdk.getSessionMessages,
			claudeProjectsDir: this.claudeProjectsDir,
		});
	}

	async readTranscript(sessionId: string) {
		const sdk = await this.loadSdk();
		return readClaudeTranscript({
			sessionId,
			loadHistory: sdk.getSessionMessages,
			claudeProjectsDir: this.claudeProjectsDir,
		});
	}

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		const sdk = await this.loadSdk();
		const abortController = params.abortController ?? new AbortController();
		let emittedAssistantText = "";
		let streamedThinkingText = "";
		let needsSeparator = false;
		let pendingUsage: UsageInfo | undefined;

		try {
			const settings = this.buildSettings(params.model);
			const conversation = sdk.query({
				prompt: createPromptInput(params),
				options: {
					systemPrompt: params.systemPrompt,
					abortController,
					resume: params.resume,
					cwd: params.cwd,
					model: params.model,
					effort: params.effort as
						| "low"
						| "medium"
						| "high"
						| "xhigh"
						| "max"
						| undefined,
					permissionMode: "bypassPermissions",
					allowDangerouslySkipPermissions: true,
					includePartialMessages: params.stream ?? true,
					settings,
					tools: [
						"Bash",
						"Read",
						"Write",
						"Edit",
						"Glob",
						"Grep",
						"WebSearch",
						"WebFetch",
						"Skill",
					],
				},
			});

			for await (const event of conversation) {
				if (event.type === "system" && event.subtype === "init") {
					this.skills = await extractSkills(
						conversation,
						event as { skills?: string[] },
					);
					continue;
				}

				if (event.type === "system" && event.subtype === "status") {
					if (event.status === "compacting") {
						yield { type: "compacting_started" };
					} else if (event.status === null) {
						yield { type: "compacting_finished" };
					}
					continue;
				}

				if (event.type === "stream_event") {
					const raw = event.event;
					if (
						raw.type === "content_block_delta" &&
						raw.delta.type === "thinking_delta"
					) {
						streamedThinkingText += raw.delta.thinking;
						yield { type: "thinking", text: raw.delta.thinking };
					}
					if (
						raw.type === "content_block_delta" &&
						raw.delta.type === "text_delta"
					) {
						if (needsSeparator) {
							emittedAssistantText += "\n\n";
							yield { type: "text", text: "\n\n" };
							needsSeparator = false;
						}
						emittedAssistantText += raw.delta.text;
						yield { type: "text", text: raw.delta.text };
					}
					continue;
				}

				if (event.type === "assistant") {
					const nextThinking = extractThinkingText(event);
					const thinking = normalizeAssistantText(
						nextThinking,
						streamedThinkingText,
						params.stream,
					);
					if (thinking) {
						yield { type: "thinking", text: thinking };
					}
					streamedThinkingText = "";

					const nextText = extractAssistantText(event);
					const text = normalizeAssistantText(
						nextText,
						emittedAssistantText,
						params.stream,
					);
					if (text) {
						const separator = needsSeparator ? "\n\n" : "";
						emittedAssistantText += separator + text;
						yield { type: "text", text: separator + text };
						needsSeparator = false;
					}
					if (emittedAssistantText) {
						needsSeparator = true;
					}

					if (event.parent_tool_use_id === null) {
						pendingUsage = extractAssistantUsage(event, params.model);
					}
				}

				if (event.type === "result") {
					yield {
						type: "done",
						sessionId: event.session_id,
						durationMs: event.duration_ms,
						costUsd: event.total_cost_usd,
						usage: applyAuthoritativeModelUsage(
							pendingUsage,
							event,
							params.model,
						),
					};
				}
			}
		} catch (err) {
			yield { type: "error", message: extractError(err) };
		}
	}

	private buildSettings(
		model: string | undefined,
	): { autoCompactWindow: number } | undefined {
		if (!this.autoCompact || !model) return undefined;
		const contextWindow = contextWindowForResolvedModel(model);
		if (!contextWindow) return undefined;
		return { autoCompactWindow: Math.round(contextWindow * 0.8) };
	}

	private async probeSkills(cwd?: string): Promise<SkillInfo[]> {
		const sdk = await this.loadSdk();
		const abortController = new AbortController();
		let sessionId: string | undefined;

		try {
			const conversation = sdk.query({
				prompt: "",
				options: {
					abortController,
					cwd,
					permissionMode: "bypassPermissions",
					allowDangerouslySkipPermissions: true,
				},
			});

			for await (const event of conversation) {
				if (event.type === "system" && event.subtype === "init") {
					sessionId = (event as Record<string, unknown>).session_id as
						| string
						| undefined;
					this.skills = await extractSkills(
						conversation,
						event as { skills?: string[] },
					);
					abortController.abort();
					break;
				}
			}
		} catch {
			// Probe is best-effort; swallow abort errors.
		}

		if (sessionId) {
			await cleanupProbeSession(
				{
					sleep: this.sleep,
					unlinkFile: this.unlinkFile,
				},
				cwd,
				sessionId,
			);
		}
		return this.skills;
	}

	private async loadSdk(): Promise<ClaudeAdapterSdk> {
		if (this.sdk) return this.sdk;
		if (this.cachedSdk) return this.cachedSdk;
		// Non-static path prevents Bun from pre-resolving the SDK at module load time
		const sdkPath = ["@anthropic-ai", "claude-agent-sdk"].join("/");
		const mod = await import(sdkPath);
		this.cachedSdk = {
			query: mod.query,
			getSessionMessages: mod.getSessionMessages as LoadClaudeHistory,
		};
		return this.cachedSdk;
	}
}

function waitFor(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function extractThinkingText(event: {
	message?: {
		content?: Array<{
			type?: string;
			thinking?: string;
		}>;
	};
}): string {
	return (
		event.message?.content
			?.filter((block) => block.type === "thinking")
			.map((block) => block.thinking ?? "")
			.join("") ?? ""
	);
}

function extractAssistantText(event: {
	message?: {
		content?: Array<{
			type?: string;
			text?: string;
		}>;
	};
}): string {
	return (
		event.message?.content
			?.filter((block) => block.type === "text")
			.map((block) => block.text ?? "")
			.join("") ?? ""
	);
}

function normalizeAssistantText(
	text: string,
	emittedText: string,
	stream: boolean | undefined,
): string | undefined {
	if (!text) {
		return undefined;
	}

	if (stream === false || emittedText === "") {
		return text;
	}

	if (!text.startsWith(emittedText)) {
		return undefined;
	}

	const remainder = text.slice(emittedText.length);
	return remainder || undefined;
}

const HIDDEN_SKILLS = new Set([
	"batch",
	"claude-api",
	"debug",
	"loop",
	"schedule",
	"simplify",
	"update-config",
]);

async function extractSkills(
	conversation: {
		supportedCommands(): Promise<{ name: string; description: string }[]>;
	},
	initEvent: { skills?: string[] },
): Promise<SkillInfo[]> {
	const skillNames = new Set(initEvent.skills ?? []);
	if (skillNames.size === 0) return [];

	try {
		const commands = await conversation.supportedCommands();
		return commands
			.filter((c) => skillNames.has(c.name) && !HIDDEN_SKILLS.has(c.name))
			.map((c) => ({ name: c.name, description: c.description }));
	} catch {
		return [...skillNames].map((name) => ({ name, description: "" }));
	}
}

async function cleanupProbeSession(
	deps: {
		sleep: (ms: number) => Promise<void>;
		unlinkFile: (path: string) => void;
	},
	cwd: string | undefined,
	sessionId: string,
): Promise<void> {
	const dir = cwd ?? process.cwd();
	const encodedCwd = dir.replaceAll("/", "-");
	const path = `${process.env.HOME}/.claude/projects/${encodedCwd}/${sessionId}.jsonl`;

	// SDK writes the JSONL asynchronously after abort
	await deps.sleep(500);

	try {
		deps.unlinkFile(path);
	} catch {
		// Cleanup is best-effort.
	}
}

function createPromptInput(
	params: RunParams,
): string | AsyncIterable<SdkUserMessage> {
	const prompt = buildPromptWithReplyContext(
		params.prompt,
		params.replyContext,
	);

	if (!params.images || params.images.length === 0) {
		return prompt;
	}

	return (async function* (): AsyncIterable<SdkUserMessage> {
		const content: ContentBlockParam[] = [];

		for (const image of params.images ?? []) {
			const data = Buffer.from(
				await Bun.file(image.path).arrayBuffer(),
			).toString("base64");
			content.push({
				type: "image",
				source: {
					type: "base64",
					data,
					media_type: image.mediaType,
				},
			});
		}

		if (prompt) {
			content.push({ type: "text", text: prompt });
		}

		const message: MessageParam = {
			role: "user",
			content,
		};

		yield {
			type: "user",
			message,
			parent_tool_use_id: null,
		};
	})();
}
