import { randomUUID } from "node:crypto";
import type { EffortLevel } from "../../common/commands.ts";
import { resolveModelAlias } from "../../common/models.ts";
import type { Facade } from "../../common/protocol.ts";
import { runFacadePrompt } from "../application/prompt-execution/facade-runner.ts";

export interface CronAgentRunResult {
	sessionId?: string;
	text: string;
}

interface RunCronAgentOptions {
	facade: Facade;
	promptHomeDir: string;
	cwd: string;
}

export function createCronAgentRunner(options: RunCronAgentOptions) {
	return async (
		prompt: string,
		model?: string,
		effort?: EffortLevel,
	): Promise<CronAgentRunResult> => {
		const resolvedModel = model ? resolveModelAlias(model) : undefined;
		const sessionId = randomUUID();

		let resultText = "";
		let completedSessionId: string | undefined;
		let runError: Error | undefined;

		await runFacadePrompt({
			cwd: options.cwd,
			effort,
			emit: (event) => {
				if (event.type === "text") {
					resultText += event.text;
				}
				if (event.type === "error") {
					runError = new Error(event.message);
				}
				if (event.type === "done") {
					completedSessionId = event.sessionId;
				}
			},
			facade: options.facade,
			model: resolvedModel,
			ocSessionId: sessionId,
			prompt,
			promptHomeDir: options.promptHomeDir,
			stream: false,
		});

		if (runError) {
			throw runError;
		}

		return {
			sessionId: completedSessionId,
			text: resultText,
		};
	};
}
