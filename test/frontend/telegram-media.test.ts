import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	copyTelegramMedia,
	saveTelegramMedia,
} from "../../src/frontend/telegram/media.ts";

describe("saveTelegramMedia", () => {
	const mediaRoot = mkdtempSync(join(tmpdir(), "mis-media-"));
	const server = Bun.serve({
		port: 0,
		fetch() {
			return new Response("png-bytes");
		},
	});

	afterAll(() => {
		server.stop();
		rmSync(mediaRoot, { recursive: true, force: true });
	});

	test("downloads media into a date-based path", async () => {
		const saved = await saveTelegramMedia(
			mediaRoot,
			`http://127.0.0.1:${server.port}/cat.png`,
			".png",
			"image/png",
		);

		expect(saved.path.startsWith(mediaRoot)).toBe(true);
		expect(saved.path.endsWith(".png")).toBe(true);
		expect(saved.mediaType).toBe("image/png");
		expect(readFileSync(saved.path, "utf8")).toBe("png-bytes");
	});

	test("copies outbound local media into managed storage", async () => {
		const sourcePath = join(tmpdir(), "mis-outbound-chart.png");
		writeFileSync(sourcePath, "chart-bytes");

		try {
			const saved = await copyTelegramMedia(mediaRoot, sourcePath, "image/png");

			expect(saved.path.startsWith(mediaRoot)).toBe(true);
			expect(saved.path).not.toBe(sourcePath);
			expect(readFileSync(saved.path, "utf8")).toBe("chart-bytes");
		} finally {
			rmSync(sourcePath, { force: true });
		}
	});
});
