import { describe, expect, mock, test } from "bun:test";
import { createTelegramBotManager } from "../../../src/frontend/telegram/bot-manager.ts";

describe("createTelegramBotManager", () => {
	test("starts one bot per distinct token and unions allowed users", () => {
		const createFileBindings = mock((_botId: string) => ({
			close: mock(() => undefined),
			rememberMessageFile: mock(async () => undefined),
			resolveMessageFile: mock(async () => undefined),
		}));
		const startBot = mock((_options) => ({
			sendCronResult: mock(async () => undefined),
			sendHeartbeatResult: mock(async () => undefined),
			stop: mock(() => undefined),
		}));
		const manager = createTelegramBotManager({
			agents: [
				{
					agentId: "agent-railly",
					allowedUsers: [2, 1],
					botToken: "token-a",
				},
				{
					agentId: "agent-mimi",
					allowedUsers: [2, 3],
					botToken: "token-a",
				},
				{
					agentId: "agent-kuro",
					allowedUsers: [9],
					botToken: "token-b",
				},
			],
			createBotId: (token) => `bot:${token}`,
			createFileBindings,
			filesRoot: "/tmp/files",
			runtimeUrl: "ws://runtime",
			startBot,
		});

		expect(startBot).toHaveBeenCalledTimes(2);
		expect(startBot.mock.calls).toEqual([
			[
				{
					allowedUsers: [1, 2, 3],
					botId: "bot:token-a",
					filesRoot: "/tmp/files",
					rememberMessageFile: expect.any(Function),
					resolveMessageFile: expect.any(Function),
					runtimeUrl: "ws://runtime",
					token: "token-a",
				},
			],
			[
				{
					allowedUsers: [9],
					botId: "bot:token-b",
					filesRoot: "/tmp/files",
					rememberMessageFile: expect.any(Function),
					resolveMessageFile: expect.any(Function),
					runtimeUrl: "ws://runtime",
					token: "token-b",
				},
			],
		]);
		expect(createFileBindings).toHaveBeenCalledTimes(2);
		expect(manager.getBotId("agent-railly")).toBe("bot:token-a");
		expect(manager.getBotId("agent-mimi")).toBe("bot:token-a");
		expect(manager.getBotId("agent-kuro")).toBe("bot:token-b");
		expect(manager.getBotId("agent-missing")).toBeUndefined();

		manager.stop();
	});

	test("routes cron and heartbeat delivery by agent id and closes started resources", async () => {
		const botA = {
			sendCronResult: mock(async () => undefined),
			sendHeartbeatResult: mock(async () => undefined),
			stop: mock(() => undefined),
		};
		const botB = {
			sendCronResult: mock(async () => undefined),
			sendHeartbeatResult: mock(async () => undefined),
			stop: mock(() => undefined),
		};
		const fileBindingA = {
			close: mock(() => undefined),
			rememberMessageFile: mock(async () => undefined),
			resolveMessageFile: mock(async () => undefined),
		};
		const fileBindingB = {
			close: mock(() => undefined),
			rememberMessageFile: mock(async () => undefined),
			resolveMessageFile: mock(async () => undefined),
		};
		const manager = createTelegramBotManager({
			agents: [
				{
					agentId: "agent-railly",
					allowedUsers: [1],
					botToken: "token-a",
				},
				{
					agentId: "agent-kuro",
					allowedUsers: [2],
					botToken: "token-b",
				},
			],
			createBotId: (token) => `bot:${token}`,
			createFileBindings: (botId) =>
				botId === "bot:token-a" ? fileBindingA : fileBindingB,
			filesRoot: "/tmp/files",
			runtimeUrl: "ws://runtime",
			startBot: (options) => (options.botId === "bot:token-a" ? botA : botB),
		});

		await manager.sendCronResult("agent-railly", {
			jobName: "nightly",
			telegramChatId: 11,
			text: "done",
		});
		await manager.sendHeartbeatResult("agent-kuro", {
			telegramChatId: 22,
			text: "ping",
			images: [],
		});
		await manager.sendCronResult("agent-missing", {
			jobName: "noop",
			telegramChatId: 33,
			text: "ignored",
		});

		expect(botA.sendCronResult).toHaveBeenCalledWith({
			jobName: "nightly",
			telegramChatId: 11,
			text: "done",
		});
		expect(botB.sendHeartbeatResult).toHaveBeenCalledWith({
			telegramChatId: 22,
			text: "ping",
			images: [],
		});
		expect(botB.sendCronResult).not.toHaveBeenCalled();

		manager.stop();
		expect(botA.stop).toHaveBeenCalledTimes(1);
		expect(botB.stop).toHaveBeenCalledTimes(1);
		expect(fileBindingA.close).toHaveBeenCalledTimes(1);
		expect(fileBindingB.close).toHaveBeenCalledTimes(1);
	});

	test("skips bot startup when a token has no allowed users", () => {
		const warning = mock((_message: string) => undefined);
		const startBot = mock((_options) => ({
			sendCronResult: mock(async () => undefined),
			sendHeartbeatResult: mock(async () => undefined),
			stop: mock(() => undefined),
		}));
		const manager = createTelegramBotManager({
			agents: [
				{
					agentId: "agent-railly",
					allowedUsers: [],
					botToken: "token-a",
				},
			],
			createBotId: (token) => `bot:${token}`,
			createFileBindings: () => ({
				close: mock(() => undefined),
				rememberMessageFile: mock(async () => undefined),
				resolveMessageFile: mock(async () => undefined),
			}),
			filesRoot: "/tmp/files",
			logWarning: warning,
			runtimeUrl: "ws://runtime",
			startBot,
		});

		expect(startBot).not.toHaveBeenCalled();
		expect(warning).toHaveBeenCalledWith(
			"Telegram bot bot:token-a has no allowed users. Bot will not start.",
		);
		expect(manager.getBotId("agent-railly")).toBe("bot:token-a");

		manager.stop();
	});
});
