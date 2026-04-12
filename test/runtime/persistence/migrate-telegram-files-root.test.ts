import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyTelegramFilesRoot } from "../../../src/runtime/persistence/migrate-telegram-files-root.ts";
import { TelegramFileRefStore } from "../../../src/runtime/persistence/telegram-file-ref-store.ts";

describe("migrateLegacyTelegramFilesRoot", () => {
	test("moves legacy media files into the new files root and rewrites stored paths", () => {
		const root = mkdtempSync(join(tmpdir(), "tg-files-root-"));
		const dbPath = join(root, "db.sqlite");
		const legacyRoot = join(root, "media");
		const filesRoot = join(root, "files");
		const legacyFilePath = join(legacyRoot, "2026", "04", "12", "chart.png");
		mkdirSync(join(legacyRoot, "2026", "04", "12"), { recursive: true });
		writeFileSync(legacyFilePath, "chart-bytes");

		const store = new TelegramFileRefStore(dbPath);
		try {
			store.upsert({
				chatId: 1,
				messageId: 2,
				path: legacyFilePath,
				file: {
					kind: "image",
					image: {
						path: legacyFilePath,
						mediaType: "image/png",
					},
				},
				direction: "inbound",
			});

			migrateLegacyTelegramFilesRoot({ legacyRoot, filesRoot, store });

			const migratedPath = join(filesRoot, "2026", "04", "12", "chart.png");
			expect(existsSync(legacyRoot)).toBe(false);
			expect(existsSync(migratedPath)).toBe(true);
			expect(readFileSync(migratedPath, "utf8")).toBe("chart-bytes");
			expect(store.get(1, 2)?.path).toBe(migratedPath);
		} finally {
			store.close();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("merges legacy media files into an existing files root", () => {
		const root = mkdtempSync(join(tmpdir(), "tg-files-root-"));
		const dbPath = join(root, "db.sqlite");
		const legacyRoot = join(root, "media");
		const filesRoot = join(root, "files");
		const legacyFilePath = join(legacyRoot, "2026", "04", "12", "report.pdf");
		const existingFilePath = join(filesRoot, "keep.txt");
		mkdirSync(join(legacyRoot, "2026", "04", "12"), { recursive: true });
		mkdirSync(filesRoot, { recursive: true });
		writeFileSync(legacyFilePath, "report-bytes");
		writeFileSync(existingFilePath, "keep-me");

		const store = new TelegramFileRefStore(dbPath);
		try {
			store.upsert({
				chatId: 1,
				messageId: 2,
				path: legacyFilePath,
				file: {
					kind: "document",
					document: {
						path: legacyFilePath,
						displayName: "report.pdf",
					},
				},
				direction: "inbound",
			});

			migrateLegacyTelegramFilesRoot({ legacyRoot, filesRoot, store });

			const migratedPath = join(filesRoot, "2026", "04", "12", "report.pdf");
			expect(existsSync(existingFilePath)).toBe(true);
			expect(readFileSync(existingFilePath, "utf8")).toBe("keep-me");
			expect(existsSync(migratedPath)).toBe(true);
			expect(store.get(1, 2)?.path).toBe(migratedPath);
		} finally {
			store.close();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
