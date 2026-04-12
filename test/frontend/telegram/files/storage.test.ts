import { afterAll, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	copyTelegramFile,
	saveTelegramFile,
} from "../../../../src/frontend/telegram/files/storage.ts";

describe("saveTelegramFile", () => {
	const filesRoot = mkdtempSync(join(tmpdir(), "mis-media-"));
	const server = Bun.serve({
		port: 0,
		fetch() {
			return new Response("png-bytes");
		},
	});

	afterAll(() => {
		server.stop();
		rmSync(filesRoot, { recursive: true, force: true });
	});

	test("downloads file into a date-based path", async () => {
		const saved = await saveTelegramFile(
			filesRoot,
			`http://127.0.0.1:${server.port}/cat.png`,
			".png",
		);

		expect(saved.path.startsWith(filesRoot)).toBe(true);
		expect(saved.path.endsWith(".png")).toBe(true);
		expect(readFileSync(saved.path, "utf8")).toBe("png-bytes");
	});

	test("copies outbound local media into managed storage", async () => {
		const sourcePath = join(tmpdir(), "mis-outbound-chart.png");
		writeFileSync(sourcePath, "chart-bytes");

		try {
			const saved = await copyTelegramFile(filesRoot, sourcePath);

			expect(saved.path.startsWith(filesRoot)).toBe(true);
			expect(saved.path).not.toBe(sourcePath);
			expect(readFileSync(saved.path, "utf8")).toBe("chart-bytes");
		} finally {
			rmSync(sourcePath, { force: true });
		}
	});

	test("returns managed media paths without copying them again", async () => {
		const managedDir = join(filesRoot, "nested");
		mkdirSync(managedDir, { recursive: true });
		writeFileSync(join(managedDir, "managed.png"), "managed-bytes");
		const sourcePath = join(managedDir, "managed.png");

		const saved = await copyTelegramFile(filesRoot, sourcePath);

		expect(saved).toEqual({
			path: sourcePath,
		});
		expect(readFileSync(sourcePath, "utf8")).toBe("managed-bytes");
	});

	test("throws when Telegram download fails", async () => {
		const failingServer = Bun.serve({
			port: 0,
			fetch() {
				return new Response("missing", { status: 404 });
			},
		});

		try {
			await expect(
				saveTelegramFile(
					filesRoot,
					`http://127.0.0.1:${failingServer.port}/cat.png`,
					".png",
				),
			).rejects.toThrow("Failed to download Telegram file: 404");
		} finally {
			failingServer.stop();
		}
	});

	test("does not append a trailing dot for extensionless files", async () => {
		const saved = await saveTelegramFile(
			filesRoot,
			`http://127.0.0.1:${server.port}/README`,
			"",
		);

		expect(saved.path.startsWith(filesRoot)).toBe(true);
		expect(saved.path.endsWith(".")).toBe(false);
	});
});
