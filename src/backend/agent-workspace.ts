import { ensureClaudeSkillsSymlink } from "./adapters/claude-setup.ts";

export function prepareAgentWorkspace(promptHomeDir: string) {
	ensureClaudeSkillsSymlink(promptHomeDir);
}
