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
 * This `PreToolUse` hook denies any tool call that would mutate a path under
 * `.claude/`:
 *   - `Write` / `Edit`: deny when `file_path` resolves under `.claude/`.
 *   - `Bash`: deny when the command pairs a `.claude/` token with a
 *     write-intent verb (`rm`, `mv`, `cp`, `mkdir`, `rmdir`, `touch`, `tee`,
 *     `chmod`, `chown`, `ln`, `sed -i`, `perl -i`) or a redirect (`>`, `>>`).
 *     Pure reads (`cat .claude/x`, `ls .claude/`) pass through.
 *
 * Bash detection is best-effort: shell quoting, env-var expansion, and
 * subshells can defeat it. The hook is a guardrail, not a sandbox.
 */
const DENY_REASON_GENERIC =
	"Refused: paths under .claude/ are managed via symlinks. Edit the canonical source instead (e.g. ./skills/<name>/SKILL.md or ~/.outclaw/skills/<name>/SKILL.md). The .claude/ tree is not the source of truth.";

const DOT_CLAUDE_SEGMENT = /(?:^|\/)\.claude(?:\/|$)/;
// Captures the suffix after `.claude/skills/` so we can suggest the
// corresponding canonical path under `./skills/`.
const DOT_CLAUDE_SKILLS_SUFFIX = /(?:^|\/)\.claude\/skills\/(.+)$/;

const BASH_WRITE_INTENT_PATTERNS: RegExp[] = [
	/\brm\b/,
	/\bmv\b/,
	/\bcp\b/,
	/\bmkdir\b/,
	/\brmdir\b/,
	/\btouch\b/,
	/\btee\b/,
	/\bchmod\b/,
	/\bchown\b/,
	/\bln\b/,
	/\bsed\s+-[A-Za-z]*i/,
	/\bperl\s+-[A-Za-z]*i/,
	// Match `>` or `>>` that targets a file, not fd-style redirects like
	// `2>&1`, `>&2`, `&>` (these never write to a named path).
	/>(?!&)/,
];

export const blockDotClaudeHook: HookCallback = async (input) => {
	if (input.hook_event_name !== "PreToolUse") return {};

	if (input.tool_name === "Write" || input.tool_name === "Edit") {
		const filePath = (input.tool_input as { file_path?: unknown }).file_path;
		if (typeof filePath !== "string" || filePath === "") return {};
		const offending = resolveDotClaudePath(filePath, input.cwd);
		if (!offending) return {};
		return deny(offending);
	}

	if (input.tool_name === "Bash") {
		const command = (input.tool_input as { command?: unknown }).command;
		if (typeof command !== "string" || command === "") return {};
		const offending = bashTokenMutatingDotClaude(command);
		if (!offending) return {};
		return deny(offending);
	}

	return {};
};

function deny(offendingPath: string) {
	return {
		hookSpecificOutput: {
			hookEventName: "PreToolUse" as const,
			permissionDecision: "deny" as const,
			permissionDecisionReason: buildDenyReason(offendingPath),
		},
	};
}

/**
 * If the rejected path lives under `.claude/skills/<rest>`, surface the exact
 * canonical replacement (`./skills/<rest>`) so the agent can retry without
 * guesswork. Other `.claude/` paths (e.g. `.claude/settings.json`) fall back
 * to the generic message.
 */
function buildDenyReason(offendingPath: string): string {
	const match = offendingPath.match(DOT_CLAUDE_SKILLS_SUFFIX);
	if (!match) return DENY_REASON_GENERIC;
	const suffix = match[1];
	return `Refused: ${offendingPath} is under .claude/, which is a symlinked view. Edit ./skills/${suffix} (or ~/.outclaw/skills/${suffix}) instead — that is the canonical source the symlink points to.`;
}

function bashTokenMutatingDotClaude(command: string): string | undefined {
	const offending = firstDotClaudeToken(command);
	if (!offending) return undefined;
	if (!BASH_WRITE_INTENT_PATTERNS.some((pattern) => pattern.test(command))) {
		return undefined;
	}
	return offending;
}

function firstDotClaudeToken(command: string): string | undefined {
	for (const rawToken of command.split(/[\s;|&()'"`]+/)) {
		if (!rawToken) continue;
		const stripped = rawToken.replace(/^[A-Za-z_][A-Za-z0-9_]*=/, "");
		if (DOT_CLAUDE_SEGMENT.test(stripped)) return stripped;
	}
	return undefined;
}

export const blockDotClaudeHookMatcher: HookCallbackMatcher = {
	hooks: [blockDotClaudeHook],
};

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
