import { unlinkSync } from "node:fs";
import { join } from "node:path";
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
import { CLAUDE_MODEL_ALIASES, describeClaudeModel } from "./models.ts";
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

	workspaceMetadata(promptHomeDir: string) {
		return {
			ignoredWorkspaceNames: [".claude"],
			ignoredGitPaths: [join(promptHomeDir, ".claude", "skills")],
		};
	}

	/**
	 * Static Claude model catalog. The Claude adapter has no remote
	 * `model/list` to query, so the adapter owns Claude's aliases, SDK ids,
	 * effort compatibility, and context windows locally.
	 */
	async listModels(): Promise<ProviderModelInfo[]> {
		return CLAUDE_MODEL_ALIASES.map((alias) => describeClaudeModel(alias));
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
