import { randomUUID } from "node:crypto";
import type { EffortLevel } from "../../common/commands.ts";
import { isModelAlias, resolveModelAlias } from "../../common/models.ts";
import { runFacadePrompt } from "../application/prompt-execution/facade-runner.ts";
import type { PromptProviderResolver } from "../application/prompt-execution/prompt-runner.ts";
import type { ModelProviderResolver } from "../model-provider-resolver.ts";

export interface CronAgentRunResult {
	providerId: string;
	sessionId?: string;
	text: string;
}

export class CronAgentRunError extends Error {
	constructor(
		message: string,
		readonly providerId: string,
		readonly sessionId: string,
	) {
		super(message);
		this.name = "CronAgentRunError";
	}
}

interface RunCronAgentOptions {
	/**
	 * Provider resolver used to look up the cron facade by the provider id
	 * resolved from the job's `model` field. Cron jobs do not have a separate
	 * provider field, so model ids must resolve to exactly one configured
	 * provider.
	 */
	providers: PromptProviderResolver;
	modelProviderResolver: ModelProviderResolver;
	promptHomeDir: string;
	cwd: string;
}

export function createCronAgentRunner(options: RunCronAgentOptions) {
	return async (
		prompt: string,
		model?: string,
		effort?: EffortLevel,
	): Promise<CronAgentRunResult> => {
		if (!model) {
			throw new Error(
				"Cron job requires an explicit `model` field — the runtime cannot infer the provider without it.",
			);
		}
		const providerId =
			await options.modelProviderResolver.resolveProviderIdForModel(model);
		if (!providerId) {
			throw new Error(
				`Cron job model ${model} does not resolve to a known provider`,
			);
		}
		const facade = options.providers.getFacade(providerId);
		// Claude aliases are resolved to their SDK id; Codex / other provider
		// ids pass through verbatim because their model ids are not aliases.
		const resolvedModel = isModelAlias(model)
			? resolveModelAlias(model)
			: model;
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
			facade,
			model: resolvedModel,
			ocSessionId: sessionId,
			prompt,
			promptHomeDir: options.promptHomeDir,
			stream: false,
		});

		if (runError) {
			throw new CronAgentRunError(
				runError.message,
				providerId,
				completedSessionId ?? sessionId,
			);
		}

		return {
			providerId,
			sessionId: completedSessionId,
			text: resultText,
		};
	};
}
