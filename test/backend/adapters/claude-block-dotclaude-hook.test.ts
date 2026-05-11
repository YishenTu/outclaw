import { describe, expect, test } from "bun:test";
import type {
	PreToolUseHookInput,
	PreToolUseHookSpecificOutput,
	SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { blockDotClaudeHook } from "../../../src/backend/adapters/claude/block-dotclaude-hook.ts";

type PreToolUseHookOutput = Omit<SyncHookJSONOutput, "hookSpecificOutput"> & {
	hookSpecificOutput?: PreToolUseHookSpecificOutput;
};

const baseInput = {
	session_id: "s",
	transcript_path: "/tmp/transcript",
	cwd: "/work/repo",
	tool_use_id: "t1",
	hook_event_name: "PreToolUse",
} satisfies Omit<PreToolUseHookInput, "tool_input" | "tool_name">;

async function run(
	toolName: string,
	filePath: unknown,
): Promise<PreToolUseHookOutput> {
	return expectSyncHookOutput(
		await blockDotClaudeHook(
			{
				...baseInput,
				tool_name: toolName,
				tool_input: { file_path: filePath },
			},
			"t1",
			{ signal: new AbortController().signal },
		),
	);
}

async function runBash(command: unknown): Promise<PreToolUseHookOutput> {
	return expectSyncHookOutput(
		await blockDotClaudeHook(
			{ ...baseInput, tool_name: "Bash", tool_input: { command } },
			"t1",
			{ signal: new AbortController().signal },
		),
	);
}

function expectSyncHookOutput(
	output: Awaited<ReturnType<typeof blockDotClaudeHook>>,
): PreToolUseHookOutput {
	if ("async" in output) {
		throw new Error("Expected synchronous hook output");
	}
	const hookSpecificOutput = output.hookSpecificOutput;
	if (hookSpecificOutput && hookSpecificOutput.hookEventName !== "PreToolUse") {
		throw new Error("Expected PreToolUse hook output");
	}

	return { ...output, hookSpecificOutput };
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

	test("does not intercept Bash even with .claude/ in the command", async () => {
		const out = await runBash("rm -rf .claude/skills/foo");
		expect(out.hookSpecificOutput).toBeUndefined();
	});
});
