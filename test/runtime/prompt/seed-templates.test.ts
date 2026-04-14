import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedTemplates } from "../../../src/runtime/prompt/seed-templates.ts";

let target: string;
let source: string;

const FILES = ["AGENTS.md", "SOUL.md", "USER.md", "MEMORY.md", "HEARTBEAT.md"];

beforeEach(() => {
	target = mkdtempSync(join(tmpdir(), "mis-target-"));
	source = mkdtempSync(join(tmpdir(), "mis-source-"));
	for (const file of FILES) {
		writeFileSync(join(source, file), `template:${file}`);
	}
});

afterEach(() => {
	rmSync(target, { recursive: true });
	rmSync(source, { recursive: true });
});

describe("seedTemplates", () => {
	test("copies all files when none exist in target", () => {
		seedTemplates(target, source);

		for (const file of FILES) {
			expect(existsSync(join(target, file))).toBe(true);
			expect(readFileSync(join(target, file), "utf-8")).toBe(
				`template:${file}`,
			);
		}
	});

	test("replaces the seeded agent-name placeholder in text templates", () => {
		writeFileSync(
			join(source, "AGENTS.md"),
			"cwd: ~/.outclaw/agents/<agent-name>/\n",
		);

		seedTemplates(target, source, {
			agentName: "railly",
		});

		expect(readFileSync(join(target, "AGENTS.md"), "utf-8")).toBe(
			"cwd: ~/.outclaw/agents/railly/\n",
		);
	});

	test("does not overwrite existing files", () => {
		writeFileSync(join(target, "AGENTS.md"), "custom agents");

		seedTemplates(target, source);

		expect(readFileSync(join(target, "AGENTS.md"), "utf-8")).toBe(
			"custom agents",
		);
	});

	test("copies only missing files", () => {
		writeFileSync(join(target, "SOUL.md"), "my soul");

		seedTemplates(target, source);

		expect(readFileSync(join(target, "SOUL.md"), "utf-8")).toBe("my soul");
		expect(readFileSync(join(target, "AGENTS.md"), "utf-8")).toBe(
			"template:AGENTS.md",
		);
	});

	test("handles missing source templates gracefully", () => {
		rmSync(join(source, "HEARTBEAT.md"));

		seedTemplates(target, source);

		expect(existsSync(join(target, "AGENTS.md"))).toBe(true);
		expect(existsSync(join(target, "HEARTBEAT.md"))).toBe(false);
	});

	test("throws on unexpected filesystem errors", () => {
		const targetFile = join(target, "not-a-directory");
		writeFileSync(targetFile, "x");

		expect(() => seedTemplates(targetFile, source)).toThrow();
	});

	test("recursively copies subdirectories and their contents", () => {
		const skillSource = join(source, "skills", "my-skill");
		mkdirSync(skillSource, { recursive: true });
		writeFileSync(join(skillSource, "SKILL.md"), "name: my-skill");
		mkdirSync(join(skillSource, "references"));
		writeFileSync(join(skillSource, "references", "guide.md"), "ref content");

		seedTemplates(target, source);

		expect(
			readFileSync(join(target, "skills", "my-skill", "SKILL.md"), "utf-8"),
		).toBe("name: my-skill");
		expect(
			readFileSync(
				join(target, "skills", "my-skill", "references", "guide.md"),
				"utf-8",
			),
		).toBe("ref content");
	});

	test("does not overwrite existing files in subdirectories", () => {
		const skillSource = join(source, "skills", "my-skill");
		mkdirSync(skillSource, { recursive: true });
		writeFileSync(join(skillSource, "SKILL.md"), "template version");

		const existingSkill = join(target, "skills", "my-skill");
		mkdirSync(existingSkill, { recursive: true });
		writeFileSync(join(existingSkill, "SKILL.md"), "user version");

		seedTemplates(target, source);

		expect(
			readFileSync(join(target, "skills", "my-skill", "SKILL.md"), "utf-8"),
		).toBe("user version");
	});

	test("copies all file types in subdirectories", () => {
		const cronSource = join(source, "cron");
		mkdirSync(cronSource, { recursive: true });
		writeFileSync(join(cronSource, "daily.yaml"), "name: daily");
		writeFileSync(join(cronSource, "notes.txt"), "some notes");

		seedTemplates(target, source);

		expect(readFileSync(join(target, "cron", "daily.yaml"), "utf-8")).toBe(
			"name: daily",
		);
		expect(readFileSync(join(target, "cron", "notes.txt"), "utf-8")).toBe(
			"some notes",
		);
	});
});
