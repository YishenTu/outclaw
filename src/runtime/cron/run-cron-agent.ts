import { resolveModelAlias } from "../../common/models.ts";
import type { Facade } from "../../common/protocol.ts";
import { assembleSystemPrompt } from "../prompt/assemble-system-prompt.ts";

export interface CronAgentRunResult {
	sessionId?: string;
	text: string;
}

interface RunCronAgentOptions {
	facade: Facade;
	promptHomeDir: string;
	cwd: string;
	effort?: string;
}

export function createCronAgentRunner(options: RunCronAgentOptions) {
	return async (
		prompt: string,
		model?: string,
	): Promise<CronAgentRunResult> => {
		const systemPrompt = await assembleSystemPrompt(options.promptHomeDir);
		const resolvedModel = model ? resolveModelAlias(model) : undefined;

		let resultText = "";
		let sessionId: string | undefined;

		for await (const event of options.facade.run({
			prompt,
			systemPrompt,
			cwd: options.cwd,
			model: resolvedModel,
			effort: options.effort,
			stream: false,
		})) {
			if (event.type === "text") {
				resultText += event.text;
			}
			if (event.type === "error") {
				throw new Error(event.message);
			}
			if (event.type === "done") {
				sessionId = event.sessionId;
				break;
			}
		}

		return {
			sessionId,
			text: resultText,
		};
	};
}
