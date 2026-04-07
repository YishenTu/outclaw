import { join } from "node:path";

const PROMPT_FILES = ["AGENTS.md", "SOUL.md", "USER.md", "MEMORY.md"] as const;

function isMissingPromptFile(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export async function readPromptFiles(promptHomeDir: string): Promise<string> {
	const sections: string[] = [];

	for (const file of PROMPT_FILES) {
		try {
			const content = await Bun.file(join(promptHomeDir, file)).text();
			if (content) sections.push(content);
		} catch (error) {
			// File doesn't exist — skip silently
			if (isMissingPromptFile(error)) {
				continue;
			}
			throw error;
		}
	}

	return sections.join("\n\n");
}
