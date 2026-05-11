import { describe, expect, test } from "bun:test";
import {
	mkdtempSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBrowserFile } from "../../../../src/runtime/browser/files/read-browser-file.ts";
import {
	FileConflictError,
	writeBrowserFile,
} from "../../../../src/runtime/browser/files/write-browser-file.ts";

function makeTempRoot(prefix: string): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), prefix));
	return {
		root,
		cleanup: () => rmSync(root, { force: true, recursive: true }),
	};
}

describe("writeBrowserFile", () => {
	test("writes text content and returns a fresh read model", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-file-write-");
		try {
			const path = join(root, "notes.md");
			writeFileSync(path, "old");
			const baseline = await readBrowserFile(root, path);

			const next = await writeBrowserFile(root, path, "new", {
				mtimeMs: baseline.mtimeMs as number,
				sha256: baseline.sha256 as string,
			});

			expect(next).toMatchObject({
				content: "new",
				kind: "text",
				language: "markdown",
				path: "notes.md",
				truncated: false,
			});
			expect(next.mtimeMs).toBeNumber();
			expect(next.sha256).toMatch(/^[a-f0-9]{64}$/);
			expect(next.sha256).not.toBe(baseline.sha256);
		} finally {
			cleanup();
		}
	});

	test("throws a conflict when the file mtime changed", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-file-write-");
		try {
			const path = join(root, "notes.md");
			writeFileSync(path, "old");
			const baseline = await readBrowserFile(root, path);
			writeFileSync(path, "current");

			await expect(
				writeBrowserFile(root, path, "new", {
					mtimeMs: baseline.mtimeMs as number,
					sha256: baseline.sha256 as string,
				}),
			).rejects.toThrow(FileConflictError);
		} finally {
			cleanup();
		}
	});

	test("throws a conflict when sha changed with the same mtime", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-file-write-");
		try {
			const path = join(root, "notes.md");
			writeFileSync(path, "old");
			const baseline = await readBrowserFile(root, path);
			const originalStat = statSync(path);
			writeFileSync(path, "changed");
			utimesSync(path, originalStat.atime, originalStat.mtime);

			await expect(
				writeBrowserFile(root, path, "new", {
					mtimeMs: baseline.mtimeMs as number,
					sha256: baseline.sha256 as string,
				}),
			).rejects.toThrow(FileConflictError);
		} finally {
			cleanup();
		}
	});

	test("rejects writes outside the root directory", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-file-write-");
		const { root: outsideRoot, cleanup: cleanupOutside } = makeTempRoot(
			"outclaw-file-outside-",
		);
		try {
			const insidePath = join(root, "notes.md");
			const outsidePath = join(outsideRoot, "outside.md");
			writeFileSync(insidePath, "old");
			writeFileSync(outsidePath, "outside");
			const baseline = await readBrowserFile(root, insidePath);

			await expect(
				writeBrowserFile(root, outsidePath, "new", {
					mtimeMs: baseline.mtimeMs as number,
					sha256: baseline.sha256 as string,
				}),
			).rejects.toThrow("Path escapes agent home");
		} finally {
			cleanup();
			cleanupOutside();
		}
	});
});
