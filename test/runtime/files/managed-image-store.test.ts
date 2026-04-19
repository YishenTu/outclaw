import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveManagedImage } from "../../../src/runtime/files/managed-image-store.ts";

describe("saveManagedImage", () => {
	const cleanupPaths: string[] = [];

	afterEach(() => {
		for (const path of cleanupPaths.splice(0)) {
			if (existsSync(path)) {
				rmSync(path, { force: true, recursive: true });
			}
		}
	});

	test("stores image uploads under the managed files root", async () => {
		const filesRoot = mkdtempSync(join(tmpdir(), "outclaw-managed-image-"));
		cleanupPaths.push(filesRoot);

		const saved = await saveManagedImage(
			filesRoot,
			"image/png",
			new Uint8Array([1, 2, 3, 4]),
		);

		expect(saved.mediaType).toBe("image/png");
		expect(saved.path.startsWith(filesRoot)).toBe(true);
		expect(saved.path.endsWith(".png")).toBe(true);
		expect(readFileSync(saved.path)).toEqual(Buffer.from([1, 2, 3, 4]));
	});
});
