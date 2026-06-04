import type { EffortLevel } from "../../../common/commands.ts";
import type {
	FacadeEvent,
	ImageRef,
	PromptProvider,
	ReplyContext,
	RuntimeInstructionPolicy,
} from "../../../common/protocol.ts";
import { extractError } from "../../../common/protocol.ts";
import { buildPromptWithReplyContext } from "../../../common/reply-context.ts";
import { assembleSystemPrompt } from "../../prompt/assemble-system-prompt.ts";
import { buildSessionEnv } from "../../prompt/session-env.ts";
import { RuntimeImageEventExtractor } from "./image-event-extractor.ts";

export interface FacadePromptRun {
	abortController?: AbortController;
	cwd?: string;
	effort?: EffortLevel;
	emit: (event: FacadeEvent) => void;
	facade: PromptProvider;
	images?: ImageRef[];
	includeSystemPrompt?: boolean;
	model?: string;
	ocSessionId: string;
	prompt: string;
	promptHomeDir?: string;
	replyContext?: ReplyContext;
	resume?: string;
	serviceTier?: string;
	stream?: boolean;
}

export async function runFacadePrompt(options: FacadePromptRun): Promise<void> {
	const imageEventExtractor = new RuntimeImageEventExtractor();

	try {
		const instructionPolicy = await buildInstructionPolicy(
			options.promptHomeDir,
			options.includeSystemPrompt,
		);
		const sessionEnv = buildSessionEnv(
			options.promptHomeDir,
			options.ocSessionId,
		);
		const prompt = buildPromptWithReplyContext(
			options.prompt,
			options.replyContext,
		);

		for await (const event of options.facade.run({
			prompt,
			images: options.images,
			instructionPolicy,
			abortController: options.abortController,
			resume: options.resume,
			sessionId: options.resume ? undefined : options.ocSessionId,
			cwd: options.cwd,
			resourceHomeDir: options.promptHomeDir,
			model: options.model,
			effort: options.effort,
			serviceTier: options.serviceTier,
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

async function buildInstructionPolicy(
	promptHomeDir: string | undefined,
	includeSystemPrompt: boolean | undefined,
): Promise<RuntimeInstructionPolicy> {
	if (!promptHomeDir || includeSystemPrompt === false) {
		return { mode: "provider_default" };
	}
	const systemPrompt = await assembleSystemPrompt(promptHomeDir);
	// An assembled prompt with no content is indistinguishable from
	// "no Outclaw instructions at all"; treat it as provider_default so the
	// adapter does not falsely advertise a runtime-constructed instruction
	// source.
	if (!systemPrompt) {
		return { mode: "provider_default" };
	}
	return { mode: "runtime_constructed", systemPrompt };
}
