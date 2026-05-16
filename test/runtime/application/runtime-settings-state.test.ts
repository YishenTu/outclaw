import { describe, expect, test } from "bun:test";
import { DEFAULT_EFFORT } from "../../../src/common/commands.ts";
import { RuntimeSettingsState } from "../../../src/runtime/application/state/runtime-settings-state.ts";

describe("RuntimeSettingsState", () => {
	test("starts with provider-default model and default effort", () => {
		const state = new RuntimeSettingsState();
		expect(state.model).toBe("");
		expect(state.effort).toBe(DEFAULT_EFFORT);
	});

	test("can start with a composition-provided default model", () => {
		const state = new RuntimeSettingsState({ defaultModel: "opus" });
		expect(state.model).toBe("opus");
		expect(state.resolvedModel).toBe("opus");
	});

	test("setProviderModel changes the opaque provider-local model", () => {
		const state = new RuntimeSettingsState();
		state.setProviderModel("gpt-5.5");

		expect(state.model).toBe("gpt-5.5");
		expect(state.resolvedModel).toBe("gpt-5.5");
	});

	test("setEffort changes effort", () => {
		const state = new RuntimeSettingsState();
		state.setEffort("low");

		expect(state.effort).toBe("low");
	});
});
