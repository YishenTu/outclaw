import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Outclaw-owned Codex project config layer. Codex resolves this file from
 * thread `cwd` and merges it on top of the user's global `~/.codex/config.toml`
 * when the project workspace is trusted. The layer is intentionally narrow —
 * it does not duplicate model defaults, approval/sandbox policy, or anything
 * that belongs to Outclaw runtime state.
 *
 * - `personality = "friendly"` shifts the Codex chat tone toward Outclaw's
 *   conversational chat surface.
 * - `[features].multi_agent = false` and `[features].memories = false`
 *   disable Codex features Outclaw does not want active during Chat mode.
 */
const CODEX_AGENT_PROJECT_CONFIG = `personality = "friendly"

[features]
multi_agent = false
memories = false
`;

export interface CodexWorkspacePaths {
	skillsDir: string;
	codexDir: string;
	codexSkillsLink: string;
	codexConfigPath: string;
}

export function codexWorkspacePaths(
	promptHomeDir: string,
): CodexWorkspacePaths {
	const codexDir = join(promptHomeDir, ".codex");
	return {
		skillsDir: join(promptHomeDir, "skills"),
		codexDir,
		codexSkillsLink: join(codexDir, "skills"),
		codexConfigPath: join(codexDir, "config.toml"),
	};
}

/**
 * Idempotently materialize the Codex provider view of an agent workspace.
 *
 * - `agentHome/skills/` remains the canonical Outclaw skill source.
 * - `agentHome/.codex/skills` is the Codex-visible symlink to `../skills`.
 * - `agentHome/.codex/config.toml` is the Outclaw-owned Codex project layer.
 *
 * Outclaw owns this template. The user's `~/.codex/config.toml` and
 * `auth.json` remain in place; the project layer wins only for the keys it
 * sets, and Codex still applies user/global config for everything else.
 */
export function ensureCodexAgentWorkspace(promptHomeDir: string): void {
	const paths = codexWorkspacePaths(promptHomeDir);

	mkdirSync(paths.skillsDir, { recursive: true });
	mkdirSync(paths.codexDir, { recursive: true });

	if (!existsSync(paths.codexSkillsLink)) {
		symlinkSync("../skills", paths.codexSkillsLink);
	}

	if (!existsSync(paths.codexConfigPath)) {
		writeFileSync(paths.codexConfigPath, CODEX_AGENT_PROJECT_CONFIG);
	}
}

export { CODEX_AGENT_PROJECT_CONFIG };
