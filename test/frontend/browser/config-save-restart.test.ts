import { describe, expect, test } from "bun:test";
import {
	CONFIG_SAVE_RESTART_COMMAND,
	CONFIG_SAVE_RESTART_ERROR,
	requestConfigRestart,
} from "../../../src/frontend/browser/commands/config-save-restart.ts";

describe("config save restart", () => {
	test("requests a runtime restart after config save", () => {
		const commands: string[] = [];
		const error = requestConfigRestart((command) => {
			commands.push(command);
			return true;
		});

		expect(error).toBeNull();
		expect(commands).toEqual([CONFIG_SAVE_RESTART_COMMAND]);
	});

	test("returns an error when the restart request is not accepted", () => {
		const error = requestConfigRestart(() => false);

		expect(error).toBe(CONFIG_SAVE_RESTART_ERROR);
	});
});
