import type { Facade } from "../../common/protocol.ts";
import type { SessionService } from "./session-service.ts";
import type { RuntimePromptContext } from "./state/runtime-state.ts";

export const AUTO_TITLE_SYSTEM_PROMPT =
	"Generate a 3-6 word title summarizing the user's request. Reply with the title only - no quotes, punctuation, prefixes, or explanations. Match the language of the user's message.";

export function buildAutoTitlePrompt(prompt: string): string {
	return [
		"Create a concise 3-6 word title for the user's request below.",
		"Do not answer the request. Summarize the user's intent as a title only.",
		"",
		"<request>",
		prompt.trim(),
		"</request>",
	].join("\n");
}

const DEFAULT_TIMEOUT_MS = 15_000;
const AUTO_TITLE_SOURCES = new Set(["tui", "browser", "telegram"]);

interface AutoTitleCoordinatorOptions {
	cwd?: string;
	facade: Facade;
	model: string;
	sessions: SessionService;
	timeoutMs?: number;
}

interface AutoTitleStartParams {
	context: RuntimePromptContext;
	prompt: string;
	source: string;
}

export class AutoTitleCoordinator {
	private readonly pending = new Map<string, AutoTitleRun>();
	private readonly started = new Set<string>();

	constructor(private readonly options: AutoTitleCoordinatorOptions) {}

	start(params: AutoTitleStartParams) {
		if (!this.shouldStart(params)) {
			return;
		}

		const attempt = new AutoTitleAttempt({
			cwd: this.options.cwd,
			expectedTitle: params.context.sessionTitle ?? "Untitled",
			facade: this.options.facade,
			model: this.options.model,
			prompt: params.prompt,
			sessions: this.options.sessions,
			timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		});
		const run: AutoTitleRun = {
			attempt,
			promise: attempt.run().catch(() => undefined),
		};
		run.promise = run.promise.finally(() => {
			if (this.pending.get(params.context.ocSessionId) === run) {
				this.pending.delete(params.context.ocSessionId);
			}
		});
		this.pending.set(params.context.ocSessionId, run);
		this.started.add(params.context.ocSessionId);
	}

	resolveSession(ocSessionId: string, sdkSessionId: string) {
		this.pending.get(ocSessionId)?.attempt.resolveSession(sdkSessionId);
		this.started.delete(ocSessionId);
	}

	cancel(ocSessionId: string) {
		const run = this.pending.get(ocSessionId);
		if (!run) {
			return;
		}
		run.attempt.cancel();
		this.started.delete(ocSessionId);
	}

	cancelAll() {
		for (const run of this.pending.values()) {
			run.attempt.cancel();
		}
		this.started.clear();
	}

	async drain(): Promise<void> {
		await Promise.allSettled(
			[...this.pending.values()].map((run) => run.promise),
		);
	}

	private shouldStart(params: AutoTitleStartParams): boolean {
		if (!this.options.sessions.canPersistSessions) {
			return false;
		}
		if (!AUTO_TITLE_SOURCES.has(params.source)) {
			return false;
		}
		if (params.context.sessionId !== undefined) {
			return false;
		}
		if (this.started.has(params.context.ocSessionId)) {
			return false;
		}
		return params.prompt.trim() !== "";
	}
}

interface AutoTitleRun {
	attempt: AutoTitleAttempt;
	promise: Promise<void>;
}

interface AutoTitleAttemptOptions {
	cwd?: string;
	expectedTitle: string;
	facade: Facade;
	model: string;
	prompt: string;
	sessions: SessionService;
	timeoutMs: number;
}

class AutoTitleAttempt {
	private readonly abortController = new AbortController();
	private readonly session = createDeferred<string | undefined>();
	private canceled = false;

	constructor(private readonly options: AutoTitleAttemptOptions) {}

	resolveSession(sdkSessionId: string) {
		this.session.resolve(sdkSessionId);
	}

	cancel() {
		this.canceled = true;
		this.abortController.abort();
		this.session.resolve(undefined);
	}

	async run() {
		const title = await this.generateTitle();
		const sdkSessionId = await this.session.promise;
		if (this.canceled || !sdkSessionId) {
			return;
		}

		if (!title) {
			this.options.sessions.markAutoTitleAttempted(sdkSessionId);
			return;
		}

		this.options.sessions.applyAutoTitle({
			expectedTitle: this.options.expectedTitle,
			sessionId: sdkSessionId,
			title,
		});
	}

	private async generateTitle(): Promise<string | undefined> {
		let text = "";
		let failed = false;
		const timeout = setTimeout(() => {
			this.abortController.abort();
		}, this.options.timeoutMs);

		try {
			for await (const event of this.options.facade.run({
				abortController: this.abortController,
				cwd: this.options.cwd,
				effort: "low",
				ephemeral: true,
				model: this.options.model,
				prompt: buildAutoTitlePrompt(this.options.prompt),
				stream: false,
				systemPrompt: AUTO_TITLE_SYSTEM_PROMPT,
				tools: [],
			})) {
				if (event.type === "text") {
					text += event.text;
					continue;
				}
				if (event.type === "error") {
					failed = true;
					break;
				}
				if (event.type === "done") {
					break;
				}
			}
		} catch {
			failed = true;
		} finally {
			clearTimeout(timeout);
		}

		if (failed || this.abortController.signal.aborted) {
			return undefined;
		}
		return normalizeAutoTitle(text);
	}
}

export function normalizeAutoTitle(raw: string): string | undefined {
	let title = raw.split(/\r?\n/, 1)[0]?.trim() ?? "";
	title = stripWrapping(title, '"');
	title = stripWrapping(title, "'");
	title = stripWrapping(title, "`");
	title = title.replace(/\s+/g, " ").trim();
	title = capTitle(title, 60);
	title = title.replace(/[.!?]$/, "").trim();
	return title === "" || !/[\p{L}\p{N}]/u.test(title) ? undefined : title;
}

function stripWrapping(value: string, wrapper: string): string {
	if (
		value.length >= 2 &&
		value.startsWith(wrapper) &&
		value.endsWith(wrapper)
	) {
		return value.slice(1, -1).trim();
	}
	return value;
}

function capTitle(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	const truncated = value.slice(0, maxLength).trimEnd();
	const lastSpace = truncated.lastIndexOf(" ");
	if (lastSpace > 0) {
		return truncated.slice(0, lastSpace);
	}
	return truncated;
}

function createDeferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}
