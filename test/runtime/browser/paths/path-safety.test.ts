import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	normalizeBrowserPath,
	resolveExistingPathWithinRoot,
	resolveWithinCronDirectory,
	resolveWithinRoot,
	resolveWritablePathWithinRoot,
	toRelativeDescendantPath,
	toRelativePath,
} from "../../../../src/runtime/browser/paths/path-safety.ts";

describe("browser path safety", () => {
	const cleanupPaths: string[] = [];

	afterEach(() => {
		for (const path of cleanupPaths.splice(0)) {
			if (existsSync(path)) {
				rmSync(path, { force: true, recursive: true });
			}
		}
	});

	test("resolves descendants and rejects escaping paths", () => {
		const root = "/tmp/outclaw-agent";

		expect(resolveWithinRoot(root, "notes/today.md")).toBe(
			join(root, "notes/today.md"),
		);
		expect(() => resolveWithinRoot(root, "../outside.md")).toThrow(
			"Path escapes agent home",
		);
		expect(() => resolveWithinRoot(root, "   ")).toThrow("Path is required");
	});

	test("restricts cron mutations to the cron directory", () => {
		const root = "/tmp/outclaw-agent";

		expect(resolveWithinCronDirectory(root, "cron/daily.yaml")).toBe(
			join(root, "cron/daily.yaml"),
		);
		expect(() => resolveWithinCronDirectory(root, "AGENTS.md")).toThrow(
			"Path escapes cron directory",
		);
	});

	test("normalizes relative browser paths", () => {
		const root = "/tmp/outclaw";
		const nested = join(root, "agents", "railly", "AGENTS.md");

		expect(toRelativePath(root, nested)).toBe("agents/railly/AGENTS.md");
		expect(toRelativeDescendantPath(root, nested)).toBe(
			"agents/railly/AGENTS.md",
		);
		expect(toRelativeDescendantPath(root, "/tmp/elsewhere/file.md")).toBe(
			undefined,
		);
		expect(normalizeBrowserPath("agents/railly/")).toBe("agents/railly");
	});

	test("rejects existing symlink targets that escape the root", () => {
		const root = mkdtempSync(join(tmpdir(), "outclaw-path-safety-"));
		cleanupPaths.push(root);
		const outsideDir = join(root, "..", "outclaw-path-safety-outside");
		mkdirSync(outsideDir, { recursive: true });
		cleanupPaths.push(outsideDir);

		const outsideFile = join(outsideDir, "secret.txt");
		writeFileSync(outsideFile, "secret\n");
		symlinkSync(outsideFile, join(root, "link.txt"));

		expect(() => resolveExistingPathWithinRoot(root, "link.txt")).toThrow(
			"Path escapes agent home",
		);
		expect(() => resolveWritablePathWithinRoot(root, "link.txt")).toThrow(
			"Path escapes agent home",
		);
	});

	test("rejects dangling symlink leaves for writable paths", () => {
		const root = mkdtempSync(join(tmpdir(), "outclaw-path-safety-"));
		cleanupPaths.push(root);
		const outsideDir = join(root, "..", "outclaw-path-safety-missing");
		mkdirSync(outsideDir, { recursive: true });
		cleanupPaths.push(outsideDir);

		symlinkSync(join(outsideDir, "missing.txt"), join(root, "link.txt"));

		expect(() => resolveWritablePathWithinRoot(root, "link.txt")).toThrow(
			"Path escapes agent home",
		);
	});

	test("allows missing writable leaves under the root", () => {
		const root = mkdtempSync(join(tmpdir(), "outclaw-path-safety-"));
		cleanupPaths.push(root);
		mkdirSync(join(root, "notes"));

		expect(resolveWritablePathWithinRoot(root, "notes/today.md")).toBe(
			join(root, "notes/today.md"),
		);
	});
});
