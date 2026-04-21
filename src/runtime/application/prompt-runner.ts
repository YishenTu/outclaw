import type { EffortLevel } from "../../common/commands.ts";
import type {
	Facade,
	FacadeEvent,
	ImageRef,
	ReplyContext,
} from "../../common/protocol.ts";
import { extractError } from "../../common/protocol.ts";
import { assembleSystemPrompt } from "../prompt/assemble-system-prompt.ts";
import { buildSessionEnv } from "../prompt/session-env.ts";
import { RuntimeImageEventExtractor } from "./image-event-extractor.ts";

export interface PromptRunnerTask {
	images?: ImageRef[];
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
		const imageEventExtractor = new RuntimeImageEventExtractor();

		try {
			const systemPrompt = this.options.promptHomeDir
				? await assembleSystemPrompt(this.options.promptHomeDir)
				: undefined;
			const sessionEnv = buildSessionEnv(
				this.options.promptHomeDir,
				options.ocSessionId,
			);

			for await (const event of this.options.facade.run({
				prompt: options.task.prompt,
				images: options.task.images,
				replyContext: options.task.replyContext,
				systemPrompt,
				abortController: options.abortController,
				resume: options.resume,
				sessionId: options.resume ? undefined : options.ocSessionId,
				cwd: this.options.cwd,
				model: options.model,
				effort: options.effort,
				stream: options.task.stream,
				sessionEnv,
			})) {
				options.emit(event);
				if (event.type !== "text") {
					continue;
				}

				for (const imageEvent of imageEventExtractor.extract(event.text)) {
					options.emit(imageEvent);
				}
			}
		} catch (err) {
			options.emit({
				type: "error",
				message: extractError(err),
			});
		}
	}
}
