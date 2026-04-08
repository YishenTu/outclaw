import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SessionStore } from "../../../src/runtime/persistence/session-store.ts";
import { TelegramMediaRefStore } from "../../../src/runtime/persistence/telegram-media-ref-store.ts";

const TEST_DB = join(import.meta.dir, ".tmp-telegram-media-ref-test.sqlite");

function cleanupDb(path: string) {
	if (existsSync(path)) rmSync(path);
	if (existsSync(`${path}-wal`)) rmSync(`${path}-wal`);
	if (existsSync(`${path}-shm`)) rmSync(`${path}-shm`);
}

describe("TelegramMediaRefStore", () => {
	afterEach(() => {
		cleanupDb(TEST_DB);
	});

	test("stores and retrieves telegram message image refs", () => {
		const store = new TelegramMediaRefStore(TEST_DB);

		store.upsert({
			chatId: 123,
			messageId: 456,
			path: "/tmp/cat.png",
			mediaType: "image/png",
			direction: "inbound",
		});

		expect(store.get(123, 456)).toEqual({
			chatId: 123,
			messageId: 456,
			path: "/tmp/cat.png",
			mediaType: "image/png",
			direction: "inbound",
			createdAt: expect.any(Number),
		});

		store.close();
	});

	test("uses the same sqlite file cleanly alongside SessionStore", () => {
		const sessionStore = new SessionStore(TEST_DB);
		const mediaRefStore = new TelegramMediaRefStore(TEST_DB);

		sessionStore.upsert({
			sdkSessionId: "sdk-123",
			title: "Hello",
			model: "opus",
		});
		mediaRefStore.upsert({
			chatId: 1,
			messageId: 2,
			path: "/tmp/chart.png",
			mediaType: "image/png",
			direction: "outbound",
		});

		expect(sessionStore.get("sdk-123")?.title).toBe("Hello");
		expect(mediaRefStore.get(1, 2)?.path).toBe("/tmp/chart.png");

		sessionStore.close();
		mediaRefStore.close();
	});

	test("default journal mode avoids sqlite sidecar files", () => {
		const store = new TelegramMediaRefStore(TEST_DB);

		store.upsert({
			chatId: 1,
			messageId: 2,
			path: "/tmp/chart.png",
			mediaType: "image/png",
			direction: "outbound",
		});
		store.close();

		expect(existsSync(`${TEST_DB}-wal`)).toBe(false);
		expect(existsSync(`${TEST_DB}-shm`)).toBe(false);
	});
});
