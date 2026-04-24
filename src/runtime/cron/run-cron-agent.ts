import { randomUUID } from "node:crypto";
import type { EffortLevel } from "../../common/commands.ts";
import { resolveModelAlias } from "../../common/models.ts";
import type { Facade } from "../../common/protocol.ts";
import { assembleSystemPrompt } from "../prompt/assemble-system-prompt.ts";
import { buildSessionEnv } from "../prompt/session-env.ts";

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
		const systemPrompt = await assembleSystemPrompt(options.promptHomeDir);
		const resolvedModel = model ? resolveModelAlias(model) : undefined;
		const sessionId = randomUUID();
		const sessionEnv = buildSessionEnv(options.promptHomeDir, sessionId);

		let resultText = "";
		let completedSessionId: string | undefined;

		for await (const event of options.facade.run({
			prompt,
			systemPrompt,
			sessionId,
			cwd: options.cwd,
			model: resolvedModel,
			effort,
			stream: false,
			sessionEnv,
		})) {
			if (event.type === "text") {
				resultText += event.text;
			}
			if (event.type === "error") {
				throw new Error(event.message);
			}
			if (event.type === "done") {
				completedSessionId = event.sessionId;
				break;
			}
		}

		return {
			sessionId: completedSessionId,
			text: resultText,
		};
	};
}
