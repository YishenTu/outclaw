import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const DEV_ROOT = resolve(REPO_ROOT, "dev");

describe("dev spec hygiene", () => {
	test("archived plans end at the archive pointer", async () => {
		const offenders: string[] = [];

		for await (const relativePath of new Bun.Glob("plans/*.md").scan(
			DEV_ROOT,
		)) {
			const source = await Bun.file(resolve(DEV_ROOT, relativePath)).text();
			if (!source.includes("\nArchived.")) {
				continue;
			}

			const paragraphs = source.trimEnd().split(/\n{2,}/);
			const archivePointerIndex = paragraphs.findIndex((paragraph) =>
				paragraph.includes("This file remains only"),
			);
			if (archivePointerIndex === -1) {
				offenders.push(`${relativePath}: missing archive pointer`);
				continue;
			}

			const trailingContent = paragraphs
				.slice(archivePointerIndex + 1)
				.map((paragraph) => paragraph.trim())
				.filter((paragraph) => paragraph !== "");
			if (trailingContent.length > 0) {
				offenders.push(relativePath);
			}
		}

		expect(offenders).toEqual([]);
	});

	test("design specs only reference source files that exist", async () => {
		const missing: string[] = [];
		const sourcePathPattern = /`(src\/[^`]+?\.(?:ts|tsx|md|yaml))`/g;

		for await (const relativePath of new Bun.Glob("design-specs/**/*.md").scan(
			DEV_ROOT,
		)) {
			const source = await Bun.file(resolve(DEV_ROOT, relativePath)).text();
			for (const match of source.matchAll(sourcePathPattern)) {
				const referencedPath = match[1];
				if (!referencedPath) {
					continue;
				}

				const exists = await Bun.file(
					resolve(REPO_ROOT, referencedPath),
				).exists();
				if (!exists) {
					missing.push(`${relativePath}: ${referencedPath}`);
				}
			}
		}

		expect(missing).toEqual([]);
	});
});
