import type { EffortLevel } from "../../../common/commands.ts";
import type { OutclawNativeToolHost } from "../../../common/native-tools.ts";
import type {
	FacadeEvent,
	ImageRef,
	PromptProvider,
	ReplyContext,
} from "../../../common/protocol.ts";
import { runFacadePrompt } from "./facade-runner.ts";

export interface PromptRunnerTask {
	cwd?: string;
	images?: ImageRef[];
	includeRuntimeSystemPrompt?: boolean;
	prompt: string;
	replyContext?: ReplyContext;
	stream?: boolean;
}

/**
 * Maps a runtime provider id to the backend facade that owns that provider's
 * run/replay/transcript surface. Runtime code asks for a facade by opaque
 * provider id; the resolver hides whether the daemon uses one shared adapter
 * or per-provider instances. Constructed from the runtime provider set.
 */
export interface PromptProviderResolver {
	getFacade(providerId: string): PromptProvider;
}

interface PromptRunnerOptions {
	cwd?: string;
	providers: PromptProviderResolver;
	promptHomeDir?: string;
}

interface PromptRunOptions {
	abortController: AbortController;
	effort?: EffortLevel;
	emit: (event: FacadeEvent) => void;
	model?: string;
	nativeToolHost?: OutclawNativeToolHost;
	ocSessionId: string;
	providerId: string;
	resume?: string;
	serviceTier?: string;
	task: PromptRunnerTask;
}

export class PromptRunner {
	constructor(private readonly options: PromptRunnerOptions) {}

	async run(options: PromptRunOptions): Promise<void> {
		const facade = this.options.providers.getFacade(options.providerId);
		await runFacadePrompt({
			abortController: options.abortController,
			cwd: options.task.cwd ?? this.options.cwd,
			effort: options.effort,
			emit: options.emit,
			facade,
			images: options.task.images,
			includeSystemPrompt: options.task.includeRuntimeSystemPrompt,
			model: options.model,
			nativeToolHost: options.nativeToolHost,
			ocSessionId: options.ocSessionId,
			prompt: options.task.prompt,
			promptHomeDir: this.options.promptHomeDir,
			replyContext: options.task.replyContext,
			resume: options.resume,
			serviceTier: options.serviceTier,
			stream: options.task.stream,
		});
	}
}

/**
 * Convenience: wrap a single Facade into a resolver. Single-provider
 * runtimes have exactly one possible answer regardless of the requested
 * provider id, so this resolver returns the wrapped facade for any id. The
 * caller is responsible for configuring multi-provider resolvers when
 * provider-aware routing actually matters; in production composition that
 * is `buildProviderResolver` in `create-agent-runtime.ts`.
 */
export function singleFacadeResolver(
	facade: PromptProvider,
): PromptProviderResolver {
	return {
		getFacade(_providerId: string): PromptProvider {
			return facade;
		},
	};
}
