import {
	constants,
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";

interface SeedTemplateOptions {
	agentName?: string;
}

const TEXT_TEMPLATE_EXTENSIONS = new Set([
	".md",
	".txt",
	".yaml",
	".yml",
	".json",
]);

function tryCopyFile(sourcePath: string, targetPath: string): boolean {
	try {
		copyFileSync(sourcePath, targetPath, constants.COPYFILE_EXCL);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | undefined)?.code;
		if (code === "EEXIST" || (code === "ENOENT" && !existsSync(sourcePath))) {
			return false;
		}
		throw error;
	}
}

function renderTemplateContent(
	content: string,
	options: SeedTemplateOptions,
): string {
	if (options.agentName) {
		return content.replaceAll("<agent-name>", options.agentName);
	}
	return content;
}

function maybeRenderCopiedTemplate(
	targetPath: string,
	options: SeedTemplateOptions,
): void {
	if (!options.agentName) {
		return;
	}
	if (!TEXT_TEMPLATE_EXTENSIONS.has(extname(targetPath))) {
		return;
	}

	const content = readFileSync(targetPath, "utf-8");
	const rendered = renderTemplateContent(content, options);
	if (rendered !== content) {
		writeFileSync(targetPath, rendered);
	}
}

export interface SeedResult {
	seeded: string[];
}

function seedRecursive(
	sourceDir: string,
	targetDir: string,
	options: SeedTemplateOptions,
	rootTargetDir: string,
	seeded: string[],
): void {
	if (!existsSync(sourceDir)) return;

	mkdirSync(targetDir, { recursive: true });

	for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = join(sourceDir, entry.name);
		const targetPath = join(targetDir, entry.name);
		if (entry.isDirectory()) {
			seedRecursive(sourcePath, targetPath, options, rootTargetDir, seeded);
		} else {
			const copied = tryCopyFile(sourcePath, targetPath);
			if (copied) {
				maybeRenderCopiedTemplate(targetPath, options);
				const relative = targetPath
					.slice(rootTargetDir.length)
					.replace(/^\//, "");
				seeded.push(relative);
			}
		}
	}
}

export function seedTemplates(
	promptHomeDir: string,
	templatesDir: string,
	options: SeedTemplateOptions = {},
): SeedResult {
	const seeded: string[] = [];
	seedRecursive(templatesDir, promptHomeDir, options, promptHomeDir, seeded);
	return { seeded };
}
