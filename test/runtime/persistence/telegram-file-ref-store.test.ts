import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SessionStore } from "../../../src/runtime/persistence/session-store.ts";
import { TelegramFileRefStore } from "../../../src/runtime/persistence/telegram-file-ref-store.ts";

const TEST_DB = join(import.meta.dir, ".tmp-telegram-file-ref-test.sqlite");
const PROVIDER_ID = "claude";

function cleanupDb(path: string) {
	if (existsSync(path)) rmSync(path);
	if (existsSync(`${path}-wal`)) rmSync(`${path}-wal`);
	if (existsSync(`${path}-shm`)) rmSync(`${path}-shm`);
}

describe("TelegramFileRefStore", () => {
	afterEach(() => {
		cleanupDb(TEST_DB);
	});

	test("stores and retrieves telegram message image refs", () => {
		const store = new TelegramFileRefStore(TEST_DB);

		store.upsert({
			chatId: 123,
			messageId: 456,
			path: "/tmp/cat.png",
			file: {
				kind: "image",
				image: {
					path: "/tmp/cat.png",
					mediaType: "image/png",
				},
			},
			direction: "inbound",
		});

		expect(store.get(123, 456)).toEqual({
			botId: "bot-default",
			chatId: 123,
			messageId: 456,
			path: "/tmp/cat.png",
			kind: "image",
			mediaType: "image/png",
			displayName: undefined,
			direction: "inbound",
			createdAt: expect.any(Number),
		});

		store.close();
	});

	test("stores and retrieves telegram document refs", () => {
		const store = new TelegramFileRefStore(TEST_DB);

		store.upsert({
			chatId: 123,
			messageId: 789,
			path: "/tmp/report.pdf",
			file: {
				kind: "document",
				document: {
					path: "/tmp/report.pdf",
					displayName: "report.pdf",
				},
			},
			direction: "inbound",
		});

		expect(store.get(123, 789)).toEqual({
			botId: "bot-default",
			chatId: 123,
			messageId: 789,
			path: "/tmp/report.pdf",
			kind: "document",
			mediaType: undefined,
			displayName: "report.pdf",
			direction: "inbound",
			createdAt: expect.any(Number),
		});

		store.close();
	});

	test("stores and retrieves telegram voice refs", () => {
		const store = new TelegramFileRefStore(TEST_DB);

		store.upsert({
			chatId: 123,
			messageId: 790,
			path: "/tmp/note.oga",
			file: {
				kind: "voice",
				voice: {
					path: "/tmp/note.oga",
					mimeType: "audio/ogg",
					durationSeconds: 12,
				},
			},
			direction: "inbound",
		});

		expect(store.get(123, 790)).toEqual({
			botId: "bot-default",
			chatId: 123,
			messageId: 790,
			path: "/tmp/note.oga",
			kind: "voice",
			mediaType: "audio/ogg",
			displayName: undefined,
			durationSeconds: 12,
			direction: "inbound",
			createdAt: expect.any(Number),
		});

		store.close();
	});

	test("uses the same sqlite file cleanly alongside SessionStore", () => {
		const sessionStore = new SessionStore(TEST_DB);
		const fileRefStore = new TelegramFileRefStore(TEST_DB);

		sessionStore.upsert({
			providerId: PROVIDER_ID,
			sdkSessionId: "sdk-123",
			title: "Hello",
			model: "opus",
		});
		fileRefStore.upsert({
			chatId: 1,
			messageId: 2,
			path: "/tmp/chart.png",
			file: {
				kind: "image",
				image: {
					path: "/tmp/chart.png",
					mediaType: "image/png",
				},
			},
			direction: "outbound",
		});

		expect(sessionStore.get(PROVIDER_ID, "sdk-123")?.title).toBe("Hello");
		expect(fileRefStore.get(1, 2)?.path).toBe("/tmp/chart.png");

		sessionStore.close();
		fileRefStore.close();
	});

	test("rejects the legacy telegram_media_refs table", () => {
		const db = new Database(TEST_DB, { create: true });
		db.exec(`CREATE TABLE telegram_media_refs (
			chat_id INTEGER NOT NULL,
			message_id INTEGER NOT NULL,
			path TEXT NOT NULL,
			media_type TEXT NOT NULL,
			direction TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (chat_id, message_id)
		)`);
		db.query(
			"INSERT INTO telegram_media_refs VALUES (1, 2, '/tmp/old.png', 'image/png', 'inbound', 1000)",
		).run();
		db.close();

		expect(() => new TelegramFileRefStore(TEST_DB)).toThrow(
			"Unsupported legacy telegram file-ref schema",
		);
	});

	test("uses WAL during operation and cleans up on close", () => {
		const store = new TelegramFileRefStore(TEST_DB);

		store.upsert({
			chatId: 1,
			messageId: 2,
			path: "/tmp/chart.png",
			file: {
				kind: "image",
				image: {
					path: "/tmp/chart.png",
					mediaType: "image/png",
				},
			},
			direction: "outbound",
		});

		expect(existsSync(`${TEST_DB}-wal`)).toBe(true);
		expect(existsSync(`${TEST_DB}-shm`)).toBe(true);

		store.close();

		expect(existsSync(`${TEST_DB}-wal`)).toBe(false);
		expect(existsSync(`${TEST_DB}-shm`)).toBe(false);
	});

	test("closing SessionStore does not break TelegramFileRefStore on shared db", () => {
		const sessionStore = new SessionStore(TEST_DB);
		const fileRefStore = new TelegramFileRefStore(TEST_DB);

		sessionStore.upsert({
			providerId: PROVIDER_ID,
			sdkSessionId: "sdk-123",
			title: "Hello",
			model: "opus",
		});
		fileRefStore.upsert({
			chatId: 1,
			messageId: 2,
			path: "/tmp/chart.png",
			file: {
				kind: "image",
				image: {
					path: "/tmp/chart.png",
					mediaType: "image/png",
				},
			},
			direction: "outbound",
		});

		sessionStore.close();

		expect(fileRefStore.get(1, 2)?.path).toBe("/tmp/chart.png");

		fileRefStore.upsert({
			chatId: 1,
			messageId: 3,
			path: "/tmp/report.pdf",
			file: {
				kind: "document",
				document: {
					path: "/tmp/report.pdf",
					displayName: "report.pdf",
				},
			},
			direction: "outbound",
		});
		expect(fileRefStore.get(1, 3)?.displayName).toBe("report.pdf");

		fileRefStore.close();

		expect(existsSync(`${TEST_DB}-wal`)).toBe(false);
		expect(existsSync(`${TEST_DB}-shm`)).toBe(false);
	});

	test("scopes refs by bot id", () => {
		const botAStore = new TelegramFileRefStore(TEST_DB, { botId: "bot-a" });
		const botBStore = new TelegramFileRefStore(TEST_DB, { botId: "bot-b" });

		botAStore.upsert({
			chatId: 10,
			messageId: 20,
			path: "/tmp/a.png",
			file: {
				kind: "image",
				image: {
					path: "/tmp/a.png",
					mediaType: "image/png",
				},
			},
			direction: "inbound",
		});
		botBStore.upsert({
			chatId: 10,
			messageId: 20,
			path: "/tmp/b.png",
			file: {
				kind: "image",
				image: {
					path: "/tmp/b.png",
					mediaType: "image/png",
				},
			},
			direction: "inbound",
		});

		expect(botAStore.get(10, 20)?.path).toBe("/tmp/a.png");
		expect(botBStore.get(10, 20)?.path).toBe("/tmp/b.png");

		botAStore.close();
		botBStore.close();
	});

	test("upgrades an existing telegram_file_refs table without duration_seconds", () => {
		const db = new Database(TEST_DB, { create: true });
		db.exec(`CREATE TABLE telegram_file_refs (
			bot_id TEXT NOT NULL,
			chat_id INTEGER NOT NULL,
			message_id INTEGER NOT NULL,
			path TEXT NOT NULL,
			kind TEXT NOT NULL,
			media_type TEXT NOT NULL DEFAULT '',
			display_name TEXT,
			direction TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (bot_id, chat_id, message_id)
		)`);
		db.close();

		const store = new TelegramFileRefStore(TEST_DB);
		const schema = new Database(TEST_DB);
		const columns = schema
			.query("PRAGMA table_info(telegram_file_refs)")
			.all() as Array<{ name: string }>;
		schema.close();

		expect(columns.map((column) => column.name)).toContain("duration_seconds");

		store.upsert({
			chatId: 10,
			messageId: 20,
			path: "/tmp/voice.ogg",
			file: {
				kind: "voice",
				voice: {
					path: "/tmp/voice.ogg",
					mimeType: "audio/ogg",
				},
			},
			direction: "outbound",
		});

		expect(store.get(10, 20)).toEqual({
			botId: "bot-default",
			chatId: 10,
			messageId: 20,
			path: "/tmp/voice.ogg",
			kind: "voice",
			mediaType: "audio/ogg",
			displayName: undefined,
			durationSeconds: undefined,
			direction: "outbound",
			createdAt: expect.any(Number),
		});

		store.close();
	});
});
