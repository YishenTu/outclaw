import {
	constants,
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
} from "node:fs";
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

function tryCopyFile(sourcePath: string, targetPath: string): void {
	try {
		copyFileSync(sourcePath, targetPath, constants.COPYFILE_EXCL);
	} catch (error) {
		if (shouldSkipTemplateCopy(error, sourcePath)) {
			return;
		}
		throw error;
	}
}

export function seedTemplates(
	promptHomeDir: string,
	templatesDir: string,
): void {
	for (const file of TEMPLATE_FILES) {
		tryCopyFile(join(templatesDir, file), join(promptHomeDir, file));
	}

	seedCronTemplates(join(promptHomeDir, "cron"), join(templatesDir, "cron"));
}

function seedCronTemplates(cronDir: string, templateCronDir: string): void {
	if (!existsSync(templateCronDir)) return;

	mkdirSync(cronDir, { recursive: true });

	for (const file of readdirSync(templateCronDir)) {
		if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
		tryCopyFile(join(templateCronDir, file), join(cronDir, file));
	}
}
