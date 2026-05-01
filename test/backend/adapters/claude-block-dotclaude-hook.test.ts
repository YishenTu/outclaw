import { describe, expect, test } from "bun:test";
import { blockDotClaudeHook } from "../../../src/backend/adapters/claude-block-dotclaude-hook.ts";

const baseInput = {
	session_id: "s",
	transcript_path: "/tmp/transcript",
	cwd: "/work/repo",
	tool_use_id: "t1",
	hook_event_name: "PreToolUse" as const,
};

async function run(toolName: string, filePath: unknown) {
	// biome-ignore lint/suspicious/noExplicitAny: hook input shape from SDK
	return blockDotClaudeHook(
		{ ...baseInput, tool_name: toolName, tool_input: { file_path: filePath } },
		"t1",
		{ signal: new AbortController().signal },
	) as Promise<any>;
}

async function runBash(command: unknown) {
	return blockDotClaudeHook(
		{ ...baseInput, tool_name: "Bash", tool_input: { command } },
		"t1",
		{ signal: new AbortController().signal },
	) as Promise<any>;
}

describe("blockDotClaudeHook", () => {
	test("denies Write into a relative .claude/ path", async () => {
		const out = await run("Write", ".claude/settings.json");
		expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
		expect(out.hookSpecificOutput?.permissionDecisionReason).toContain(
			".claude/",
		);
	});

	test("denies Edit into an absolute .claude/ path", async () => {
		const out = await run("Edit", "/work/repo/.claude/skills/foo/SKILL.md");
		expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	test("suggests the canonical ./skills/ path for .claude/skills/ writes", async () => {
		const out = await run("Edit", ".claude/skills/foo/SKILL.md");
		const reason = out.hookSpecificOutput?.permissionDecisionReason as string;
		expect(reason).toContain("./skills/foo/SKILL.md");
		expect(reason).toContain("~/.outclaw/skills/foo/SKILL.md");
	});

	test("falls back to generic reason for non-skills .claude/ paths", async () => {
		const out = await run("Write", ".claude/settings.json");
		const reason = out.hookSpecificOutput?.permissionDecisionReason as string;
		expect(reason).toContain(".claude/");
		expect(reason).not.toContain("./skills/settings.json");
	});

	test("denies a tilde-prefixed .claude/ path", async () => {
		const previous = process.env.HOME;
		process.env.HOME = "/home/test";
		try {
			const out = await run("Write", "~/.claude/settings.json");
			expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
		} finally {
			process.env.HOME = previous;
		}
	});

	test("denies a nested .claude/ segment anywhere in the path", async () => {
		const out = await run("Edit", "/tmp/proj/sub/.claude/foo.md");
		expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	test("allows Write to ./skills/ (the canonical source)", async () => {
		const out = await run("Write", "./skills/foo/SKILL.md");
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	test("allows Edit outside .claude/", async () => {
		const out = await run("Edit", "/work/repo/src/foo.ts");
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	test("ignores non-Write/Edit tools even with .claude/ paths", async () => {
		const out = await run("Read", ".claude/settings.json");
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	test("does not match a directory whose name merely contains .claude", async () => {
		const out = await run("Edit", "/work/repo/.claude-backup/foo.md");
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	test("ignores Write when file_path is missing", async () => {
		const out = await run("Write", undefined);
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	describe("Bash", () => {
		test("denies redirect into .claude/", async () => {
			const out = await runBash("echo hi > .claude/settings.json");
			expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
		});

		test("denies append redirect into .claude/", async () => {
			const out = await runBash("echo hi >> .claude/settings.json");
			expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
		});

		test("denies rm -rf on .claude/", async () => {
			const out = await runBash("rm -rf .claude/skills/foo");
			expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
		});

		test("denies mv into .claude/", async () => {
			const out = await runBash("mv tmp.json .claude/settings.json");
			expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
		});

		test("denies cp into .claude/", async () => {
			const out = await runBash("cp foo.md .claude/skills/foo/SKILL.md");
			expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
		});

		test("suggests canonical path when Bash writes into .claude/skills/", async () => {
			const out = await runBash("cp foo.md .claude/skills/foo/SKILL.md");
			const reason = out.hookSpecificOutput
				?.permissionDecisionReason as string;
			expect(reason).toContain("./skills/foo/SKILL.md");
		});

		test("denies mkdir under .claude/", async () => {
			const out = await runBash("mkdir -p .claude/skills/new");
			expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
		});

		test("denies sed -i on .claude/", async () => {
			const out = await runBash("sed -i 's/a/b/' .claude/settings.json");
			expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
		});

		test("denies tee into .claude/", async () => {
			const out = await runBash("echo hi | tee .claude/x");
			expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
		});

		test("denies absolute-path mutation", async () => {
			const out = await runBash("rm -rf /home/u/proj/.claude/x");
			expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
		});

		test("allows reads from .claude/", async () => {
			const out = await runBash("cat .claude/settings.json");
			expect(out.hookSpecificOutput).toBeUndefined();
		});

		test("allows ls .claude/", async () => {
			const out = await runBash("ls -la .claude/skills/");
			expect(out.hookSpecificOutput).toBeUndefined();
		});

		test("allows write that does not touch .claude/", async () => {
			const out = await runBash("rm -rf ./build && mkdir ./dist");
			expect(out.hookSpecificOutput).toBeUndefined();
		});

		test("does not match .claude-backup/ path", async () => {
			const out = await runBash("rm -rf .claude-backup/foo");
			expect(out.hookSpecificOutput).toBeUndefined();
		});

		test("does not flag fd redirects like 2>&1 against a .claude/ read", async () => {
			const out = await runBash("ls -la .claude/ 2>&1 | head");
			expect(out.hookSpecificOutput).toBeUndefined();
		});

		test("does not flag >&2 against a .claude/ read", async () => {
			const out = await runBash("cat .claude/x >&2");
			expect(out.hookSpecificOutput).toBeUndefined();
		});

		test("still denies stderr-to-file redirect into .claude/", async () => {
			const out = await runBash("foo 2> .claude/err.log");
			expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
		});

		test("ignores Bash when command is missing", async () => {
			const out = await runBash(undefined);
			expect(out.hookSpecificOutput).toBeUndefined();
		});
	});
});
