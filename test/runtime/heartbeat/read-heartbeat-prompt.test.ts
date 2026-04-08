import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHeartbeatPrompt } from "../../../src/runtime/heartbeat/read-heartbeat-prompt.ts";

function tmp() {
	return mkdtempSync(join(tmpdir(), "mis-heartbeat-"));
}

describe("readHeartbeatPrompt", () => {
	test("returns undefined when HEARTBEAT.md is missing", async () => {
		const dir = tmp();
		try {
			expect(await readHeartbeatPrompt(dir)).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test("removes full-line html comments and trims the result", async () => {
		const dir = tmp();
		try {
			writeFileSync(
				join(dir, "HEARTBEAT.md"),
				"\n<!-- internal note -->\n\nCheck CI failures.\n<!-- another note -->\n",
			);

			expect(await readHeartbeatPrompt(dir)).toBe("Check CI failures.");
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test("returns undefined when content is empty after cleanup", async () => {
		const dir = tmp();
		try {
			writeFileSync(
				join(dir, "HEARTBEAT.md"),
				"\n<!-- internal note -->\n   \n<!-- still internal -->\n",
			);

			expect(await readHeartbeatPrompt(dir)).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test("does not interpret multi-line html comment blocks", async () => {
		const dir = tmp();
		try {
			writeFileSync(
				join(dir, "HEARTBEAT.md"),
				"<!-- start\nhidden line\n-->\nVisible line\n",
			);

			expect(await readHeartbeatPrompt(dir)).toBe(
				"<!-- start\nhidden line\n-->\nVisible line",
			);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});
