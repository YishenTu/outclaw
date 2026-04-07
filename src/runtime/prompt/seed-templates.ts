import { constants, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEMPLATE_FILES = [
	"AGENTS.md",
	"SOUL.md",
	"USER.md",
	"MEMORY.md",
	"HEARTBEAT.md",
] as const;

function shouldSkipTemplateCopy(error: unknown, sourcePath: string): boolean {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	return code === "EEXIST" || (code === "ENOENT" && !existsSync(sourcePath));
}

export function seedTemplates(
	promptHomeDir: string,
	templatesDir: string,
): void {
	for (const file of TEMPLATE_FILES) {
		const sourcePath = join(templatesDir, file);
		const targetPath = join(promptHomeDir, file);

		try {
			copyFileSync(sourcePath, targetPath, constants.COPYFILE_EXCL);
		} catch (error) {
			// File already exists or source missing — skip silently
			if (shouldSkipTemplateCopy(error, sourcePath)) {
				continue;
			}
			throw error;
		}
	}
}
