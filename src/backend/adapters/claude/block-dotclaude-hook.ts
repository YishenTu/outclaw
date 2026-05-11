import { isAbsolute, resolve, sep } from "node:path";
import type {
	HookCallback,
	HookCallbackMatcher,
} from "@anthropic-ai/claude-agent-sdk";

/**
 * Skills, settings, and other resources under `.claude/` are managed via
 * symlinks back to canonical sources (e.g. `./skills/`, `~/.outclaw/skills/`).
 * Modifying `.claude/...` directly bypasses that contract — the symlink target
 * is the real source of truth, and writes through the symlinked tree make
 * provenance confusing.
 *
 * This `PreToolUse` hook denies `Write` and `Edit` whose `file_path` resolves
 * under any `.claude/` directory. When the rejected path lives under
 * `.claude/skills/<rest>`, the deny reason includes the exact canonical
 * replacement (`./skills/<rest>`) so the agent can retry without guesswork.
 *
 * Bash mutations are intentionally not intercepted: the realistic agent
 * failure mode is `Write`/`Edit`, and a substring-based Bash filter has
 * unbounded false positives on innocent text (commit messages, `echo`,
 * `grep` patterns, heredocs) without providing a real security boundary.
 */
const DENY_REASON_GENERIC =
	"Refused: paths under .claude/ are managed via symlinks. Edit the canonical source instead (e.g. ./skills/<name>/SKILL.md or ~/.outclaw/skills/<name>/SKILL.md). The .claude/ tree is not the source of truth.";

// Captures the suffix after `.claude/skills/` so we can suggest the
// corresponding canonical path under `./skills/`.
const DOT_CLAUDE_SKILLS_SUFFIX = /(?:^|\/)\.claude\/skills\/(.+)$/;

export const blockDotClaudeHook: HookCallback = async (input) => {
	if (input.hook_event_name !== "PreToolUse") return {};
	if (input.tool_name !== "Write" && input.tool_name !== "Edit") return {};

	const filePath = (input.tool_input as { file_path?: unknown }).file_path;
	if (typeof filePath !== "string" || filePath === "") return {};

	const offending = resolveDotClaudePath(filePath, input.cwd);
	if (!offending) return {};

	return {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: buildDenyReason(offending),
		},
	};
};

export const blockDotClaudeHookMatcher: HookCallbackMatcher = {
	hooks: [blockDotClaudeHook],
};

function buildDenyReason(offendingPath: string): string {
	const match = offendingPath.match(DOT_CLAUDE_SKILLS_SUFFIX);
	if (!match) return DENY_REASON_GENERIC;
	const suffix = match[1];
	return `Refused: ${offendingPath} is under .claude/, which is a symlinked view. Edit ./skills/${suffix} (or ~/.outclaw/skills/${suffix}) instead — that is the canonical source the symlink points to.`;
}

function resolveDotClaudePath(
	filePath: string,
	cwd: string,
): string | undefined {
	const expanded = expandHome(filePath);
	const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
	return absolute.split(sep).includes(".claude") ? absolute : undefined;
}

function expandHome(filePath: string): string {
	if (filePath !== "~" && !filePath.startsWith("~/")) return filePath;
	const home = process.env.HOME;
	if (!home) return filePath;
	return filePath === "~" ? home : `${home}${filePath.slice(1)}`;
}
