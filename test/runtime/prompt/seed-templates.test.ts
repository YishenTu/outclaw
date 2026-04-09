import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
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

		expect(() => seedTemplates(targetFile, source)).toThrow(/ENOTDIR/);
	});

	test("copies cron yaml templates into a cron directory and skips other files", () => {
		const cronSource = join(source, "cron");
		writeFileSync(join(source, "placeholder.txt"), "unused");
		Bun.write(join(cronSource, "daily.yaml"), "name: daily");
		Bun.write(join(cronSource, "weekly.yml"), "name: weekly");
		Bun.write(join(cronSource, "notes.txt"), "ignore me");

		seedTemplates(target, source);

		expect(readFileSync(join(target, "cron", "daily.yaml"), "utf-8")).toBe(
			"name: daily",
		);
		expect(readFileSync(join(target, "cron", "weekly.yml"), "utf-8")).toBe(
			"name: weekly",
		);
		expect(existsSync(join(target, "cron", "notes.txt"))).toBe(false);
	});
});
