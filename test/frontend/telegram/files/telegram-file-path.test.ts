import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	basenameFromPath,
	buildTelegramFileUrl,
	extensionFromPath,
	saveTelegramApiFile,
} from "../../../../src/frontend/telegram/files/telegram-file-path.ts";

describe("Telegram file path helpers", () => {
	const roots: string[] = [];
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		for (const root of roots) {
			rmSync(root, { force: true, recursive: true });
		}
		roots.length = 0;
	});

	test("builds Telegram file URLs and path display metadata", () => {
		expect(buildTelegramFileUrl("TOKEN", "photos/cat.JPG")).toBe(
			"https://api.telegram.org/file/botTOKEN/photos/cat.JPG",
		);
		expect(basenameFromPath("documents/report.pdf")).toBe("report.pdf");
		expect(basenameFromPath("report.pdf")).toBe("report.pdf");
		expect(extensionFromPath("documents/report.PDF")).toBe(".pdf");
		expect(extensionFromPath("documents/no-extension")).toBeUndefined();
		expect(extensionFromPath("documents/trailing.")).toBeUndefined();
	});

	test("saves Telegram API files through managed storage", async () => {
		const root = mkdtempSync(join(tmpdir(), "tg-file-path-"));
		roots.push(root);
		globalThis.fetch = mock(async (url: string) => {
			expect(url).toBe("https://api.telegram.org/file/botTOKEN/docs/a.txt");
			return new Response(Buffer.from("payload"), { status: 200 });
		}) as unknown as typeof fetch;

		const saved = await saveTelegramApiFile({
			ext: ".txt",
			filePath: "docs/a.txt",
			filesRoot: root,
			token: "TOKEN",
		});

		expect(saved.path.startsWith(root)).toBeTrue();
		expect(saved.path.endsWith(".txt")).toBeTrue();
		expect(existsSync(saved.path)).toBeTrue();
		expect(readFileSync(saved.path, "utf-8")).toBe("payload");
	});

	test("requires a managed files root before downloading", async () => {
		await expect(
			saveTelegramApiFile({
				ext: ".txt",
				filePath: "docs/a.txt",
				token: "TOKEN",
			}),
		).rejects.toThrow("Telegram files root is not configured");
	});
});
