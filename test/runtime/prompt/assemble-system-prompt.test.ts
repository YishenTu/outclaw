import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	mkdtempSync,
	rmSync,
	unlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleSystemPrompt } from "../../../src/runtime/prompt/assemble-system-prompt.ts";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "mis-test-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true });
});

function bumpMtime(path: string) {
	const future = new Date(Date.now() + 2000);
	utimesSync(path, future, future);
}

describe("assembleSystemPrompt", () => {
	test("returns empty string when no files exist", async () => {
		const result = await assembleSystemPrompt(tmp);
		expect(result).toBe("");
	});

	test("returns file content wrapped in xml tags", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "be helpful");

		const result = await assembleSystemPrompt(tmp);
		expect(result).toContain("<agents>");
		expect(result).toContain("be helpful");
	});

	test("preserves file order", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "agents");
		writeFileSync(join(tmp, "MEMORY.md"), "memory");

		const result = await assembleSystemPrompt(tmp);

		const agentsIdx = result.indexOf("<agents>");
		const memoryIdx = result.indexOf("<memory>");
		expect(agentsIdx).toBeLessThan(memoryIdx);
	});

	test("returns cached result when files unchanged", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "agents");

		const first = await assembleSystemPrompt(tmp);
		const second = await assembleSystemPrompt(tmp);

		expect(second).toBe(first);
	});

	test("picks up new file created after initial read", async () => {
		const first = await assembleSystemPrompt(tmp);
		expect(first).toBe("");

		writeFileSync(join(tmp, "SOUL.md"), "soul content");

		const second = await assembleSystemPrompt(tmp);
		expect(second).toContain("soul content");
	});

	test("picks up edited file content after mtime change", async () => {
		const path = join(tmp, "AGENTS.md");
		writeFileSync(path, "original");

		const first = await assembleSystemPrompt(tmp);
		expect(first).toContain("original");

		writeFileSync(path, "updated");
		bumpMtime(path);

		const second = await assembleSystemPrompt(tmp);
		expect(second).toContain("updated");
		expect(second).not.toContain("original");
	});

	test("picks up file deletion", async () => {
		const path = join(tmp, "AGENTS.md");
		writeFileSync(path, "agents");

		const first = await assembleSystemPrompt(tmp);
		expect(first).toContain("<agents>");

		unlinkSync(path);

		const second = await assembleSystemPrompt(tmp);
		expect(second).not.toContain("<agents>");
	});

	test("invalidates cache when directory changes", async () => {
		writeFileSync(join(tmp, "AGENTS.md"), "agents");
		await assembleSystemPrompt(tmp);

		const otherDir = mkdtempSync(join(tmpdir(), "mis-test-other-"));
		try {
			writeFileSync(join(otherDir, "SOUL.md"), "other soul");

			const result = await assembleSystemPrompt(otherDir);
			expect(result).toContain("other soul");
			expect(result).not.toContain("agents");
		} finally {
			rmSync(otherDir, { recursive: true });
		}
	});
});
