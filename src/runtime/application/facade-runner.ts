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

export interface FacadePromptRun {
	abortController?: AbortController;
	cwd?: string;
	effort?: EffortLevel;
	emit: (event: FacadeEvent) => void;
	facade: Facade;
	images?: ImageRef[];
	model?: string;
	ocSessionId: string;
	prompt: string;
	promptHomeDir?: string;
	replyContext?: ReplyContext;
	resume?: string;
	stream?: boolean;
}

export async function runFacadePrompt(options: FacadePromptRun): Promise<void> {
	const imageEventExtractor = new RuntimeImageEventExtractor();

	try {
		const systemPrompt = options.promptHomeDir
			? await assembleSystemPrompt(options.promptHomeDir)
			: undefined;
		const sessionEnv = buildSessionEnv(
			options.promptHomeDir,
			options.ocSessionId,
		);

		for await (const event of options.facade.run({
			prompt: options.prompt,
			images: options.images,
			replyContext: options.replyContext,
			systemPrompt,
			abortController: options.abortController,
			resume: options.resume,
			sessionId: options.resume ? undefined : options.ocSessionId,
			cwd: options.cwd,
			model: options.model,
			effort: options.effort,
			stream: options.stream,
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
