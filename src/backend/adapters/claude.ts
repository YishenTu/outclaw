import { unlinkSync } from "node:fs";
import {
	extractError,
	type Facade,
	type FacadeEvent,
	type RunParams,
	type SkillInfo,
} from "../../common/protocol.ts";
import {
	type LoadClaudeHistory,
	readClaudeHistory,
	readClaudeReplay,
	readClaudeTranscript,
} from "./claude-history/index.ts";
import {
	type ClaudeSdkUserMessage,
	createClaudePromptInput,
} from "./claude-prompt-input.ts";
import { buildClaudeSdkOptions } from "./claude-sdk-options.ts";
import { ensureClaudeSkillsSymlink } from "./claude-setup.ts";
import {
	cleanupClaudeSessionFile,
	probeClaudeSkills,
} from "./claude-skill-probe.ts";
import { normalizeClaudeStream } from "./claude-stream-normalizer.ts";

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

	prepareWorkspace(promptHomeDir: string): void {
		ensureClaudeSkillsSymlink(promptHomeDir);
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
				onSkills: (skills) => {
					this.skills = skills;
				},
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

	private async probeSkills(cwd?: string): Promise<SkillInfo[]> {
		const sdk = await this.loadSdk();
		this.skills = await probeClaudeSkills({
			cwd,
			query: sdk.query,
			sleep: this.sleep,
			unlinkFile: this.unlinkFile,
		});
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
