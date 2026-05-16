import { describe, expect, test } from "bun:test";
import {
	canonicalizePromptSlashCommand,
	DEFAULT_EFFORT,
	EFFORT_LEVELS,
	findSlashCommand,
	isEffortLevel,
	isPromptSlashCommand,
	isRuntimeCommand,
	listSlashCommands,
	PROMPT_COMMANDS,
	routeSlashCommand,
	SLASH_COMMANDS,
} from "../../src/common/commands.ts";

describe("isEffortLevel", () => {
	test("returns true for each known level", () => {
		for (const level of EFFORT_LEVELS) {
			expect(isEffortLevel(level)).toBe(true);
		}
	});

	test("returns false for unknown strings", () => {
		expect(isEffortLevel("extreme")).toBe(false);
		expect(isEffortLevel("")).toBe(false);
		expect(isEffortLevel("HIGH")).toBe(false);
	});
});

describe("isRuntimeCommand", () => {
	test("recognises bare commands", () => {
		expect(isRuntimeCommand("/new")).toBe(true);
		expect(isRuntimeCommand("/stop")).toBe(true);
		expect(isRuntimeCommand("/restart")).toBe(true);
		expect(isRuntimeCommand("/status")).toBe(true);
		expect(isRuntimeCommand("/model")).toBe(true);
		expect(isRuntimeCommand("/thinking")).toBe(true);
		expect(isRuntimeCommand("/session")).toBe(true);
	});

	test("recognises commands with arguments", () => {
		expect(isRuntimeCommand("/model haiku")).toBe(true);
		expect(isRuntimeCommand("/thinking max")).toBe(true);
		expect(isRuntimeCommand("/session list")).toBe(true);
	});

	test("/compact is NOT a runtime command", () => {
		expect(isRuntimeCommand("/compact")).toBe(false);
	});

	test("returns false for non-commands", () => {
		expect(isRuntimeCommand("hello")).toBe(false);
		expect(isRuntimeCommand("")).toBe(false);
		expect(isRuntimeCommand("/unknown")).toBe(false);
		expect(isRuntimeCommand("/newx")).toBe(false);
	});

	test("handles leading/trailing whitespace", () => {
		expect(isRuntimeCommand("  /new  ")).toBe(true);
		expect(isRuntimeCommand("  /model haiku  ")).toBe(true);
	});
});

describe("isPromptSlashCommand", () => {
	test("/compact is a prompt slash command", () => {
		expect(isPromptSlashCommand("/compact")).toBe(true);
	});

	test("runtime commands are not prompt slash commands", () => {
		expect(isPromptSlashCommand("/model")).toBe(false);
		expect(isPromptSlashCommand("/new")).toBe(false);
		expect(isPromptSlashCommand("/status")).toBe(false);
	});

	test("returns false for non-commands", () => {
		expect(isPromptSlashCommand("hello")).toBe(false);
		expect(isPromptSlashCommand("/unknown")).toBe(false);
	});
});

describe("SLASH_COMMANDS", () => {
	test("lists commands by transport without duplicating catalog entries", () => {
		expect(listSlashCommands()).toEqual(SLASH_COMMANDS);
		expect(listSlashCommands("runtime")).toEqual(
			SLASH_COMMANDS.filter((command) => command.transport === "runtime"),
		);
		expect(listSlashCommands("prompt")).toEqual(PROMPT_COMMANDS);
	});

	test("/compact has prompt transport", () => {
		const compact = SLASH_COMMANDS.find((c) => c.command === "compact");
		expect(compact?.transport).toBe("prompt");
	});

	test("runtime commands have runtime transport", () => {
		const model = SLASH_COMMANDS.find((c) => c.command === "model");
		expect(model?.transport).toBe("runtime");
	});
});

describe("routeSlashCommand", () => {
	test("keeps prompt and runtime routing behind the catalog", () => {
		expect(routeSlashCommand("/compact")).toEqual({
			command: "compact",
			source: "catalog",
			transport: "prompt",
		});

		for (const command of [
			"status",
			"model",
			"thinking",
			"agent",
			"session",
			"new",
			"stop",
			"restart",
		]) {
			expect(routeSlashCommand(`/${command} arg`)).toEqual({
				command,
				source: "catalog",
				transport: "runtime",
			});
		}
	});

	test("leaves provider-specific model shortcuts out of the shared catalog", () => {
		expect(routeSlashCommand("/sonnet")).toBeUndefined();
	});
});

describe("PROMPT_COMMANDS", () => {
	test("contains /compact", () => {
		expect(PROMPT_COMMANDS).toEqual([
			expect.objectContaining({
				command: "compact",
				transport: "prompt",
			}),
		]);
	});
});

describe("findSlashCommand", () => {
	test("finds slash commands by the first token", () => {
		expect(findSlashCommand("/compact")).toEqual(
			expect.objectContaining({ command: "compact", transport: "prompt" }),
		);
		expect(findSlashCommand("/model sonnet")).toEqual(
			expect.objectContaining({ command: "model", transport: "runtime" }),
		);
	});

	test("returns undefined for unknown inputs", () => {
		expect(findSlashCommand("hello")).toBeUndefined();
		expect(findSlashCommand("/unknown")).toBeUndefined();
	});
});

describe("canonicalizePromptSlashCommand", () => {
	test("canonicalizes builtin prompt commands with surrounding whitespace", () => {
		expect(canonicalizePromptSlashCommand(" /compact ")).toBe("/compact");
	});

	test("does not canonicalize prompt commands with extra arguments", () => {
		expect(canonicalizePromptSlashCommand("/compact now")).toBeUndefined();
	});

	test("does not canonicalize runtime or unknown commands", () => {
		expect(canonicalizePromptSlashCommand("/model")).toBeUndefined();
		expect(canonicalizePromptSlashCommand("/unknown")).toBeUndefined();
	});
});

describe("defaults", () => {
	test("DEFAULT_EFFORT is a valid level", () => {
		expect(isEffortLevel(DEFAULT_EFFORT)).toBe(true);
	});
});
