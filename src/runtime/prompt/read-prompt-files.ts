import { join } from "node:path";

const PROMPT_FILES = [
	{ file: "AGENTS.md", tag: "agents" },
	{ file: "SOUL.md", tag: "soul" },
	{ file: "USER.md", tag: "user" },
	{ file: "MEMORY.md", tag: "memory" },
] as const;

function isMissingPromptFile(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export async function readPromptFiles(promptHomeDir: string): Promise<string> {
	const sections: string[] = [];

	for (const { file, tag } of PROMPT_FILES) {
		try {
			const content = await Bun.file(join(promptHomeDir, file)).text();
			if (content) sections.push(`<${tag}>\n${content}\n</${tag}>`);
		} catch (error) {
			if (isMissingPromptFile(error)) {
				continue;
			}
			throw error;
		}
	}

	return sections.join("\n\n");
}
