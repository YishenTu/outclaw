import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBrowserFile } from "../../../../src/runtime/browser/files/read-browser-file.ts";

function makeTempRoot(prefix: string): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), prefix));
	return {
		root,
		cleanup: () => rmSync(root, { force: true, recursive: true }),
	};
}

describe("readBrowserFile", () => {
	test("returns complete text content for files larger than 512 KiB", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-file-preview-");
		try {
			mkdirSync(join(root, "notes"));
			const content = `${"a".repeat(512 * 1024)}tail`;
			writeFileSync(join(root, "notes", "large.md"), content);

			await expect(
				readBrowserFile(root, join(root, "notes", "large.md")),
			).resolves.toEqual({
				content,
				kind: "text",
				language: "markdown",
				path: "notes/large.md",
				truncated: false,
			});
		} finally {
			cleanup();
		}
	});
});
