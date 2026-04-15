import { describe, expect, test } from "bun:test";
import { createCronTelegramChatIdResolver } from "../../../src/runtime/cron/resolve-telegram-chat-id.ts";

describe("createCronTelegramChatIdResolver", () => {
	test("prefers per-job telegramUserId", () => {
		const resolve = createCronTelegramChatIdResolver({
			allowedUsers: [101, 202],
			defaultCronUserId: 101,
		});

		expect(
			resolve({
				name: "daily",
				telegramUserId: 202,
			}),
		).toBe(202);
	});

	test("falls back to the agent default cron user id", () => {
		const resolve = createCronTelegramChatIdResolver({
			allowedUsers: [101, 202],
			defaultCronUserId: 101,
		});

		expect(
			resolve({
				name: "daily",
			}),
		).toBe(101);
	});

	test("infers the single allowed user when no explicit cron target is configured", () => {
		const resolve = createCronTelegramChatIdResolver({
			allowedUsers: [101],
		});

		expect(
			resolve({
				name: "daily",
			}),
		).toBe(101);
	});

	test("returns undefined when multiple users are allowed and no cron target is configured", () => {
		const resolve = createCronTelegramChatIdResolver({
			allowedUsers: [101, 202],
		});

		expect(
			resolve({
				name: "daily",
			}),
		).toBeUndefined();
	});

	test("rejects a cron target user that is not in allowedUsers", () => {
		const resolve = createCronTelegramChatIdResolver({
			allowedUsers: [101, 202],
		});

		expect(() =>
			resolve({
				name: "daily",
				telegramUserId: 303,
			}),
		).toThrow('Cron job "daily" telegramUserId 303 is not in allowedUsers');
	});

	test("rejects an agent default cron user that is not in allowedUsers", () => {
		const resolve = createCronTelegramChatIdResolver({
			allowedUsers: [101, 202],
			defaultCronUserId: 303,
		});

		expect(() =>
			resolve({
				name: "daily",
			}),
		).toThrow("Agent defaultCronUserId 303 is not in allowedUsers");
	});
});
