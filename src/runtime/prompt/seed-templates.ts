import {
	constants,
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
} from "node:fs";
import { join } from "node:path";

function tryCopyFile(sourcePath: string, targetPath: string): void {
	try {
		copyFileSync(sourcePath, targetPath, constants.COPYFILE_EXCL);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | undefined)?.code;
		if (code === "EEXIST" || (code === "ENOENT" && !existsSync(sourcePath))) {
			return;
		}
		throw error;
	}
}

function seedRecursive(sourceDir: string, targetDir: string): void {
	if (!existsSync(sourceDir)) return;

	mkdirSync(targetDir, { recursive: true });

	for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = join(sourceDir, entry.name);
		const targetPath = join(targetDir, entry.name);
		if (entry.isDirectory()) {
			seedRecursive(sourcePath, targetPath);
		} else {
			tryCopyFile(sourcePath, targetPath);
		}
	}
}

export function seedTemplates(
	promptHomeDir: string,
	templatesDir: string,
): void {
	seedRecursive(templatesDir, promptHomeDir);
}
