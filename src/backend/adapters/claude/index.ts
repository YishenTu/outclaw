import { unlinkSync } from "node:fs";
import { effortLevelsForModel } from "../../../common/commands.ts";
import { MODEL_ALIAS_LIST, type ModelAlias } from "../../../common/models.ts";
import {
	extractError,
	type Facade,
	type FacadeEvent,
	type ProviderModelInfo,
	type RunParams,
} from "../../../common/protocol.ts";
import {
	type LoadClaudeHistory,
	readClaudeHistory,
	readClaudeReplay,
	readClaudeTranscript,
} from "./history/index.ts";
import {
	type ClaudeSdkUserMessage,
	createClaudePromptInput,
} from "./prompt-input.ts";
import { buildClaudeSdkOptions } from "./sdk-options.ts";
import { ensureClaudeSkillsSymlink } from "./setup.ts";
import { cleanupClaudeSessionFile } from "./skill-probe.ts";
import { normalizeClaudeStream } from "./stream-normalizer.ts";

type SdkQueryFn = (params: {
	prompt: string | AsyncIterable<ClaudeSdkUserMessage>;
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

export class ClaudeAdapter implements Facade {
	readonly providerId = "claude";
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

	prepareWorkspace(promptHomeDir: string): void {
		ensureClaudeSkillsSymlink(promptHomeDir);
	}

	/**
	 * Static Claude model catalog. The Claude adapter has no remote
	 * `model/list` to query — the runtime keeps the alias registry in
	 * `src/common/models.ts`, and this method projects that registry into the
	 * provider-neutral `ProviderModelInfo` shape so chat composers can offer
	 * Claude and Codex models from one unified catalog.
	 */
	async listModels(): Promise<ProviderModelInfo[]> {
		return MODEL_ALIAS_LIST.map((alias) => describeClaudeModel(alias));
	}

	async readHistory(sessionId: string) {
		const sdk = await this.loadSdk();
		return readClaudeHistory({
			sessionId,
			loadHistory: sdk.getSessionMessages,
			claudeProjectsDir: this.claudeProjectsDir,
		});
	}

	async readReplay(sessionId: string) {
		const sdk = await this.loadSdk();
		return readClaudeReplay({
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
		let ephemeralSessionId: string | undefined;

		try {
			const conversation = sdk.query({
				prompt: createClaudePromptInput(params),
				options: buildClaudeSdkOptions(
					params,
					abortController,
					this.autoCompact,
				),
			});

			for await (const event of normalizeClaudeStream({
				conversation,
				model: params.model,
				stream: params.stream,
			})) {
				if (event.type === "session_initialized" || event.type === "done") {
					ephemeralSessionId ??= event.sessionId;
				}
				yield event;
			}
		} catch (err) {
			yield { type: "error", message: extractError(err) };
		} finally {
			if (params.ephemeral && ephemeralSessionId) {
				await cleanupClaudeSessionFile(
					{
						sleep: this.sleep,
						unlinkFile: this.unlinkFile,
					},
					params.cwd,
					ephemeralSessionId,
				);
			}
		}
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

function describeClaudeModel(alias: ModelAlias): ProviderModelInfo {
	const supportedEfforts = effortLevelsForModel(alias);
	const defaultEffort = supportedEfforts.includes("medium")
		? "medium"
		: (supportedEfforts[0] ?? "medium");
	return {
		id: alias,
		model: alias,
		displayName: CLAUDE_MODEL_DISPLAY_NAMES[alias] ?? alias,
		description: CLAUDE_MODEL_DESCRIPTIONS[alias] ?? "",
		isDefault: alias === DEFAULT_CLAUDE_MODEL,
		defaultReasoningEffort: defaultEffort,
		supportedReasoningEfforts: [...supportedEfforts],
		serviceTiers: [],
	};
}

const DEFAULT_CLAUDE_MODEL: ModelAlias = "opus";

const CLAUDE_MODEL_DISPLAY_NAMES: Record<ModelAlias, string> = {
	opus: "Claude Opus 4.7 (1M)",
	sonnet: "Claude Sonnet",
	haiku: "Claude Haiku",
};

const CLAUDE_MODEL_DESCRIPTIONS: Record<ModelAlias, string> = {
	opus: "Most capable Claude model.",
	sonnet: "Balanced Claude model.",
	haiku: "Fast Claude model.",
};
