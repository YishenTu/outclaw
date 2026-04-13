import { describe, expect, test } from "bun:test";
import { DEFAULT_EFFORT, DEFAULT_MODEL } from "../../../src/common/commands.ts";
import { MODEL_ALIASES } from "../../../src/common/models.ts";
import { RuntimeSettingsState } from "../../../src/runtime/application/runtime-settings-state.ts";

describe("RuntimeSettingsState", () => {
	test("starts with default model and effort", () => {
		const state = new RuntimeSettingsState();
		expect(state.model).toBe(DEFAULT_MODEL);
		expect(state.effort).toBe(DEFAULT_EFFORT);
	});

	test("resolvedModel returns the SDK model ID", () => {
		const state = new RuntimeSettingsState();
		expect(state.resolvedModel).toBe(MODEL_ALIASES[DEFAULT_MODEL]);
	});

	test("setModel changes model", () => {
		const state = new RuntimeSettingsState();
		state.setModel("haiku");

		expect(state.model).toBe("haiku");
		expect(state.resolvedModel).toBe(MODEL_ALIASES.haiku);
	});

	test("setEffort changes effort", () => {
		const state = new RuntimeSettingsState();
		state.setEffort("low");

		expect(state.effort).toBe("low");
	});
});
