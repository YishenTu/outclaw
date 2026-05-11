import type { EffortLevel } from "../../../common/commands.ts";
import type {
	Facade,
	FacadeEvent,
	ImageRef,
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

interface PromptRunnerOptions {
	cwd?: string;
	facade: Facade;
	promptHomeDir?: string;
}

interface PromptRunOptions {
	abortController: AbortController;
	effort: EffortLevel;
	emit: (event: FacadeEvent) => void;
	model: string;
	ocSessionId: string;
	resume?: string;
	task: PromptRunnerTask;
}

export class PromptRunner {
	constructor(private readonly options: PromptRunnerOptions) {}

	async run(options: PromptRunOptions): Promise<void> {
		await runFacadePrompt({
			abortController: options.abortController,
			cwd: options.task.cwd ?? this.options.cwd,
			effort: options.effort,
			emit: options.emit,
			facade: this.options.facade,
			images: options.task.images,
			includeSystemPrompt: options.task.includeRuntimeSystemPrompt,
			model: options.model,
			ocSessionId: options.ocSessionId,
			prompt: options.task.prompt,
			promptHomeDir: this.options.promptHomeDir,
			replyContext: options.task.replyContext,
			resume: options.resume,
			stream: options.task.stream,
		});
	}
}
