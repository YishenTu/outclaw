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

function seedRecursive(
	sourceDir: string,
	targetDir: string,
	options: SeedTemplateOptions,
): void {
	if (!existsSync(sourceDir)) return;

	mkdirSync(targetDir, { recursive: true });

	for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = join(sourceDir, entry.name);
		const targetPath = join(targetDir, entry.name);
		if (entry.isDirectory()) {
			seedRecursive(sourcePath, targetPath, options);
		} else {
			tryCopyFile(sourcePath, targetPath);
			maybeRenderCopiedTemplate(targetPath, options);
		}
	}
}

export function seedTemplates(
	promptHomeDir: string,
	templatesDir: string,
	options: SeedTemplateOptions = {},
): void {
	seedRecursive(templatesDir, promptHomeDir, options);
}
