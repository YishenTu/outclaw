import { join } from "node:path";

const PROMPT_FILES = [
	{ file: "AGENTS.md", tag: "agents" },
	{ file: "SOUL.md", tag: "soul" },
	{ file: "USER.md", tag: "user" },
	{ file: "MEMORY.md", tag: "memory" },
] as const;

const IGNORED_TRAILING_PROMPT_NOTES = new Set([
	"This file defines how you operate. The user may modify it to change your behavior.",
	"This file is yours to evolve. As you learn who you are, update it. If you change it, tell the user - it's your soul, and they should know.",
]);

function isMissingPromptFile(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function normalizePromptNote(line: string): string {
	return line
		.trim()
		.replace(/^[_*]+/, "")
		.replace(/[_*]+$/, "")
		.replaceAll(/\s+/g, " ")
		.replaceAll(/[–—]/g, "-")
		.trim();
}

function stripIgnoredTrailingPromptNotes(content: string): string {
	const lines = content.split("\n");

	while (lines.length > 0 && lines.at(-1)?.trim() === "") {
		lines.pop();
	}

	while (lines.length > 0) {
		const trailingLine = lines.at(-1)?.trim() ?? "";
		if (!IGNORED_TRAILING_PROMPT_NOTES.has(normalizePromptNote(trailingLine))) {
			break;
		}

		lines.pop();
		while (lines.length > 0 && lines.at(-1)?.trim() === "") {
			lines.pop();
		}
		if (lines.at(-1)?.trim() === "---") {
			lines.pop();
			while (lines.length > 0 && lines.at(-1)?.trim() === "") {
				lines.pop();
			}
		}
	}

	return lines.join("\n");
}

export async function readPromptFiles(promptHomeDir: string): Promise<string> {
	const sections: string[] = [];

	for (const { file, tag } of PROMPT_FILES) {
		try {
			const content = stripIgnoredTrailingPromptNotes(
				await Bun.file(join(promptHomeDir, file)).text(),
			);
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
