import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAgentSkills } from "../../../src/runtime/skills/list-agent-skills.ts";

describe("listAgentSkills", () => {
	test("lists agent ./skills entries from SKILL.md frontmatter", async () => {
		const agentHome = mkdtempSync(join(tmpdir(), "outclaw-agent-skills-"));
		try {
			mkdirSync(join(agentHome, "skills", "review"), { recursive: true });
			mkdirSync(join(agentHome, "skills", "voice-mode"), { recursive: true });
			mkdirSync(join(agentHome, "skills", "draft"));
			writeFileSync(
				join(agentHome, "skills", "review", "SKILL.md"),
				`---
name: review
description: Review the current changes.
---

# review
`,
			);
			writeFileSync(
				join(agentHome, "skills", "voice-mode", "SKILL.md"),
				`---
name: voice-mode
description: Transcribe local audio.
---

# voice-mode
`,
			);

			await expect(listAgentSkills(agentHome)).resolves.toEqual([
				{
					name: "review",
					description: "Review the current changes.",
				},
				{
					name: "voice-mode",
					description: "Transcribe local audio.",
				},
			]);
		} finally {
			rmSync(agentHome, { recursive: true, force: true });
		}
	});

	test("falls back to directory name and empty description when metadata is absent", async () => {
		const agentHome = mkdtempSync(join(tmpdir(), "outclaw-agent-skills-"));
		try {
			mkdirSync(join(agentHome, "skills", "local-helper"), { recursive: true });
			writeFileSync(
				join(agentHome, "skills", "local-helper", "SKILL.md"),
				"# Local helper\n",
			);

			await expect(listAgentSkills(agentHome)).resolves.toEqual([
				{
					name: "local-helper",
					description: "",
				},
			]);
		} finally {
			rmSync(agentHome, { recursive: true, force: true });
		}
	});

	test("returns an empty list when the agent has no skills directory", async () => {
		const agentHome = mkdtempSync(join(tmpdir(), "outclaw-agent-skills-"));
		try {
			await expect(listAgentSkills(agentHome)).resolves.toEqual([]);
		} finally {
			rmSync(agentHome, { recursive: true, force: true });
		}
	});
});
