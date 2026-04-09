import { describe, expect, test } from "bun:test";
import { createTelegramBridge } from "../../../src/frontend/telegram/bridge/client.ts";
import { TELEGRAM_COMMANDS } from "../../../src/frontend/telegram/commands/catalog.ts";
import { executeTelegramRuntimeCommand } from "../../../src/frontend/telegram/commands/runtime.ts";
import { startTelegramBot } from "../../../src/frontend/telegram/index.ts";
import { saveTelegramMedia } from "../../../src/frontend/telegram/media/storage.ts";
import { handleTelegramTextMessage } from "../../../src/frontend/telegram/messages/text.ts";
import { buildSessionButtons } from "../../../src/frontend/telegram/sessions/menu.ts";

describe("Telegram architecture", () => {
	test("keeps the package entrypoint stable", () => {
		expect(typeof startTelegramBot).toBe("function");
	});

	test("keeps the runtime bridge in the bridge boundary", () => {
		expect(typeof createTelegramBridge).toBe("function");
	});

	test("keeps command execution and command catalog in the commands boundary", () => {
		expect(typeof executeTelegramRuntimeCommand).toBe("function");
		expect(
			TELEGRAM_COMMANDS.some((command) => command.command === "status"),
		).toBe(true);
	});

	test("keeps media persistence in the media boundary", () => {
		expect(typeof saveTelegramMedia).toBe("function");
	});

	test("keeps inbound prompt handling in the messages boundary", () => {
		expect(typeof handleTelegramTextMessage).toBe("function");
	});

	test("keeps the session keyboard in the sessions boundary", () => {
		expect(
			buildSessionButtons(
				[{ sdkSessionId: "sdk-1", title: "Chat A", lastActive: 1_000 }],
				"sdk-1",
			),
		).toEqual([{ label: "Chat A ●", switchData: "ss:sdk-1" }]);
	});
});
