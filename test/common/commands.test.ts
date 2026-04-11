import { describe, expect, test } from "bun:test";
import {
	DEFAULT_EFFORT,
	DEFAULT_MODEL,
	EFFORT_LEVELS,
	isEffortLevel,
	isRuntimeCommand,
} from "../../src/common/commands.ts";
import { isModelAlias, MODEL_ALIAS_LIST } from "../../src/common/models.ts";

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

	test("recognises model alias shortcuts", () => {
		for (const alias of MODEL_ALIAS_LIST) {
			expect(isRuntimeCommand(`/${alias}`)).toBe(true);
		}
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

describe("defaults", () => {
	test("DEFAULT_MODEL is a valid alias", () => {
		expect(isModelAlias(DEFAULT_MODEL)).toBe(true);
	});

	test("DEFAULT_EFFORT is a valid level", () => {
		expect(isEffortLevel(DEFAULT_EFFORT)).toBe(true);
	});
});
