import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SkillInfo } from "../../common/protocol.ts";

export async function listAgentSkills(
	promptHomeDir: string,
): Promise<SkillInfo[]> {
	const skillsDir = join(promptHomeDir, "skills");
	let entries: Dirent[];
	try {
		entries = await readdir(skillsDir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
			return [];
		}
		throw error;
	}

	const skills: SkillInfo[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) {
			continue;
		}
		const skill = await readSkillMetadata(skillsDir, entry.name);
		if (skill) {
			skills.push(skill);
		}
	}

	return skills.sort((left, right) => left.name.localeCompare(right.name));
}

async function readSkillMetadata(
	skillsDir: string,
	dirName: string,
): Promise<SkillInfo | undefined> {
	let content: string;
	try {
		content = await readFile(join(skillsDir, dirName, "SKILL.md"), "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
			return undefined;
		}
		throw error;
	}

	const frontmatter = readFrontmatter(content);
	return {
		name: readString(frontmatter?.name) ?? dirName,
		description: readString(frontmatter?.description) ?? "",
	};
}

function readFrontmatter(content: string): Record<string, unknown> | undefined {
	const match = content
		.replace(/^\uFEFF/, "")
		.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match?.[1]) {
		return undefined;
	}

	const parsed = parseYaml(match[1]);
	return typeof parsed === "object" && parsed !== null
		? (parsed as Record<string, unknown>)
		: undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== ""
		? value.trim()
		: undefined;
}
