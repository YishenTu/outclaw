import { afterEach, describe, expect, test } from "bun:test";
import { useAppModeStore } from "../../../src/frontend/browser/stores/app-mode.ts";

afterEach(() => {
	useAppModeStore.setState({ appMode: "chat" });
});

describe("app mode store", () => {
	test("owns app mode independently from coding state", () => {
		useAppModeStore.getState().setAppMode("code");
		expect(useAppModeStore.getState().appMode).toBe("code");
	});
});
