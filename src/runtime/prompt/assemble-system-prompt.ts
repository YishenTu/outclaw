import { readPromptFiles } from "./read-prompt-files.ts";

export async function assembleSystemPrompt(
	promptHomeDir: string,
): Promise<string> {
	return readPromptFiles(promptHomeDir);
}
