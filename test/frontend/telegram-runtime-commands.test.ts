import { describe, expect, test } from "bun:test";
import { TELEGRAM_COMMANDS } from "../../src/frontend/telegram/commands.ts";
import {
	executeTelegramRuntimeCommand,
	TELEGRAM_RUNTIME_COMMAND_NAMES,
} from "../../src/frontend/telegram/runtime-commands.ts";

describe("Telegram runtime commands", () => {
	test("advertised commands match registered runtime handlers", () => {
		expect(TELEGRAM_COMMANDS.map((command) => command.command)).toEqual(
			TELEGRAM_RUNTIME_COMMAND_NAMES,
		);
	});

	test("/stop forwards to runtime and returns the status reply", async () => {
		const calls: string[] = [];
		const reply = await executeTelegramRuntimeCommand("stop", {
			sendCommandAndWait: async (command) => {
				calls.push(command);
				return { type: "status", message: "Stopping current run" };
			},
		});

		expect(calls).toEqual(["/stop"]);
		expect(reply).toBe("Stopping current run");
	});
});
