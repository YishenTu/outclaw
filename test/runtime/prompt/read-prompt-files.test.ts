import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPromptFiles } from "../../../src/runtime/prompt/read-prompt-files.ts";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "mis-test-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true });
});

describe("readPromptFiles", () => {
	test("returns empty string when no files exist", async () => {
		expect(await readPromptFiles(tmp)).toBe("");
	});

	test("reads a single file wrapped in xml tag", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "instructions here");
		expect(await readPromptFiles(tmp)).toBe(
			"<agents>\ninstructions here\n</agents>",
		);
	});

	test("concatenates all 4 files in order with xml tags", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "agents");
		writeFileSync(join(tmp, "SOUL.md"), "soul");
		writeFileSync(join(tmp, "USER.md"), "user");
		writeFileSync(join(tmp, "MEMORY.md"), "memory");

		const result = await readPromptFiles(tmp);
		expect(result).toBe(
			"<agents>\nagents\n</agents>\n\n" +
				"<soul>\nsoul\n</soul>\n\n" +
				"<user>\nuser\n</user>\n\n" +
				"<memory>\nmemory\n</memory>",
		);
	});

	test("skips missing files", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "agents");
		writeFileSync(join(tmp, "MEMORY.md"), "memory");

		const result = await readPromptFiles(tmp);
		expect(result).toBe(
			"<agents>\nagents\n</agents>\n\n<memory>\nmemory\n</memory>",
		);
	});

	test("skips empty files", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "agents");
		writeFileSync(join(tmp, "SOUL.md"), "");
		writeFileSync(join(tmp, "USER.md"), "user");

		const result = await readPromptFiles(tmp);
		expect(result).toBe("<agents>\nagents\n</agents>\n\n<user>\nuser\n</user>");
	});

	test("throws on unexpected filesystem errors", async () => {
		await expect(readPromptFiles("/dev/null")).rejects.toThrow(/ENOTDIR/);
	});
});
