import {
	buildInvocationContext,
	type InvocationContextOptions,
} from "./invocation-context.ts";
import { readPromptFiles } from "./read-prompt-files.ts";

export interface AssembleOptions extends InvocationContextOptions {
	promptHomeDir?: string;
}

export async function assembleSystemPrompt(
	options: AssembleOptions,
): Promise<string> {
	const files = options.promptHomeDir
		? await readPromptFiles(options.promptHomeDir)
		: "";
	const context = buildInvocationContext(options);

	return [files, context].filter(Boolean).join("\n\n");
}
