import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TelegramRouteStore } from "../../../src/runtime/persistence/telegram-route-store.ts";

const TEST_DB = join(import.meta.dir, ".tmp-telegram-route-test.sqlite");

function cleanupDb(path: string) {
	if (existsSync(path)) rmSync(path);
	if (existsSync(`${path}-wal`)) rmSync(`${path}-wal`);
	if (existsSync(`${path}-shm`)) rmSync(`${path}-shm`);
}

describe("TelegramRouteStore", () => {
	afterEach(() => {
		cleanupDb(TEST_DB);
	});

	test("stores and retrieves routes by bot and telegram user id", () => {
		const store = new TelegramRouteStore(TEST_DB);

		store.setAgentId("bot-a", 101, "agent-railly");
		store.setAgentId("bot-b", 101, "agent-mimi");

		expect(store.getAgentId("bot-a", 101)).toBe("agent-railly");
		expect(store.getAgentId("bot-b", 101)).toBe("agent-mimi");

		store.close();
	});

	test("deletes stored routes", () => {
		const store = new TelegramRouteStore(TEST_DB);

		store.setAgentId("bot-a", 101, "agent-railly");
		store.delete("bot-a", 101);

		expect(store.getAgentId("bot-a", 101)).toBeUndefined();

		store.close();
	});

	test("deletes all routes for an agent id", () => {
		const store = new TelegramRouteStore(TEST_DB);

		store.setAgentId("bot-a", 101, "agent-railly");
		store.setAgentId("bot-b", 202, "agent-mimi");
		store.setAgentId("bot-c", 303, "agent-mimi");

		store.deleteByAgentId("agent-mimi");

		expect(store.getAgentId("bot-a", 101)).toBe("agent-railly");
		expect(store.getAgentId("bot-b", 202)).toBeUndefined();
		expect(store.getAgentId("bot-c", 303)).toBeUndefined();

		store.close();
	});
});
