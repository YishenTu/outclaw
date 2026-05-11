import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

export function ensureClaudeSkillsSymlink(promptHomeDir: string): void {
	const skillsDir = join(promptHomeDir, "skills");
	const claudeDir = join(promptHomeDir, ".claude");
	const linkPath = join(claudeDir, "skills");

	mkdirSync(skillsDir, { recursive: true });
	mkdirSync(claudeDir, { recursive: true });

	if (!existsSync(linkPath)) {
		symlinkSync("../skills", linkPath);
	}
}
