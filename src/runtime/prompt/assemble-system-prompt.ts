import { join } from "node:path";
import { readPromptFiles } from "./read-prompt-files.ts";

const PROMPT_FILES = ["AGENTS.md", "SOUL.md", "USER.md", "MEMORY.md"];

let cachedPrompt: string | undefined;
let cachedMtimes: number[] = [];
let cachedDir: string | undefined;

export async function assembleSystemPrompt(
	promptHomeDir: string,
): Promise<string> {
	const mtimes = await getFileMtimes(promptHomeDir);

	if (
		cachedPrompt !== undefined &&
		cachedDir === promptHomeDir &&
		mtimesMatch(cachedMtimes, mtimes)
	) {
		return cachedPrompt;
	}

	const prompt = await readPromptFiles(promptHomeDir);
	cachedPrompt = prompt;
	cachedMtimes = mtimes;
	cachedDir = promptHomeDir;
	return prompt;
}

async function getFileMtimes(dir: string): Promise<number[]> {
	const mtimes: number[] = [];
	for (const file of PROMPT_FILES) {
		const f = Bun.file(join(dir, file));
		const mtime = (await f.exists()) ? f.lastModified : 0;
		mtimes.push(mtime);
	}
	return mtimes;
}

function mtimesMatch(a: number[], b: number[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}
