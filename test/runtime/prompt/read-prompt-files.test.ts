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

	test("reads a single file", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "instructions here");
		expect(await readPromptFiles(tmp)).toBe("instructions here");
	});

	test("concatenates all 4 files in order", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "agents");
		writeFileSync(join(tmp, "SOUL.md"), "soul");
		writeFileSync(join(tmp, "USER.md"), "user");
		writeFileSync(join(tmp, "MEMORY.md"), "memory");

		const result = await readPromptFiles(tmp);
		expect(result).toBe("agents\n\nsoul\n\nuser\n\nmemory");
	});

	test("skips missing files", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "agents");
		writeFileSync(join(tmp, "MEMORY.md"), "memory");

		const result = await readPromptFiles(tmp);
		expect(result).toBe("agents\n\nmemory");
	});

	test("skips empty files", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "agents");
		writeFileSync(join(tmp, "SOUL.md"), "");
		writeFileSync(join(tmp, "USER.md"), "user");

		const result = await readPromptFiles(tmp);
		expect(result).toBe("agents\n\nuser");
	});

	test("throws on unexpected filesystem errors", async () => {
		await expect(readPromptFiles("/dev/null")).rejects.toThrow(/ENOTDIR/);
	});
});
