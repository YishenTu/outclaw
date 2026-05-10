import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CODEX_CODING_SKILL_PATH = join(
	import.meta.dir,
	"../../src/templates/skills/codex-coding/SKILL.md",
);

describe("codex-coding skill template contract", () => {
	test("documents the simple bash delegation contract", () => {
		const skill = readFileSync(CODEX_CODING_SKILL_PATH, "utf-8");

		expect(skill).toContain("codex exec");
		expect(skill).toContain("--dangerously-bypass-approvals-and-sandbox");
		expect(skill).toContain("-C /absolute/path/to/repo");
		expect(skill).toContain("Set the Bash tool's run in background parameter");
		expect(skill).toContain(
			"For foreground delegation, do not set a Bash timeout.",
		);
		expect(skill).not.toContain("Foreground");
		expect(skill).not.toContain("Background");
		expect(skill).not.toContain(".context/codex");
		expect(skill).not.toContain("app-server");
		expect(
			countOccurrences(
				skill,
				'codex exec --dangerously-bypass-approvals-and-sandbox -C /absolute/path/to/repo "Your coding prompt"',
			),
		).toBe(1);
	});
});

function countOccurrences(value: string, pattern: string): number {
	return value.split(pattern).length - 1;
}
