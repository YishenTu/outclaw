import { describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileContentInPlace } from "../../../../src/runtime/browser/files/in-place-file-writer.ts";
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
	test("does not truncate until replacement content is fully written", async () => {
		const calls: string[] = [];
		const file = {
			async write() {
				calls.push("write");
				throw new Error("disk full");
			},
			async truncate() {
				calls.push("truncate");
			},
		};

		await expect(writeFileContentInPlace(file, "replacement")).rejects.toThrow(
			"disk full",
		);

		expect(calls).toEqual(["write"]);
	});

	test("restores baseline content when replacement write fails after partial overwrite", async () => {
		const encoder = new TextEncoder();
		const decoder = new TextDecoder();
		let content = encoder.encode("original");
		let replacementWrites = 0;
		const file = {
			async write(
				buffer: Uint8Array,
				offset: number,
				length: number,
				position: number,
			) {
				const chunk = buffer.slice(offset, offset + length);
				if (decoder.decode(buffer) === "replacement") {
					replacementWrites += 1;
					if (replacementWrites > 1) {
						throw new Error("disk full");
					}
					content.set(chunk.slice(0, 3), position);
					return { bytesWritten: 3 };
				}

				content = new Uint8Array(
					Math.max(content.byteLength, position + length),
				);
				content.set(chunk, position);
				return { bytesWritten: length };
			},
			async truncate(size: number) {
				content = content.slice(0, size);
			},
		};

		await expect(
			writeFileContentInPlace(file, "replacement", {
				restoreContent: encoder.encode("original"),
			}),
		).rejects.toThrow("disk full");

		expect(decoder.decode(content)).toBe("original");
	});

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

	test("updates the existing file in place", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-file-write-");
		try {
			const path = join(root, "run.sh");
			writeFileSync(path, "#!/bin/sh\necho old\n");
			chmodSync(path, 0o755);
			const baseline = await readBrowserFile(root, path);
			const originalStat = statSync(path);

			await writeBrowserFile(root, path, "#!/bin/sh\necho new\n", {
				mtimeMs: baseline.mtimeMs as number,
				sha256: baseline.sha256 as string,
			});

			const nextStat = statSync(path);
			expect(nextStat.ino).toBe(originalStat.ino);
			expect(nextStat.mode & 0o777).toBe(0o755);
		} finally {
			cleanup();
		}
	});

	test("rejects writes through symlinks that target files outside the root", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-file-write-");
		const { root: outsideRoot, cleanup: cleanupOutside } = makeTempRoot(
			"outclaw-file-outside-",
		);
		try {
			const outsidePath = join(outsideRoot, "outside.md");
			const linkPath = join(root, "linked.md");
			writeFileSync(outsidePath, "outside");
			symlinkSync(outsidePath, linkPath);
			const baseline = await readBrowserFile(root, linkPath);

			await expect(
				writeBrowserFile(root, linkPath, "new", {
					mtimeMs: baseline.mtimeMs as number,
					sha256: baseline.sha256 as string,
				}),
			).rejects.toThrow("Path escapes agent home");
			expect(readFileSync(outsidePath, "utf8")).toBe("outside");
		} finally {
			cleanup();
			cleanupOutside();
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
