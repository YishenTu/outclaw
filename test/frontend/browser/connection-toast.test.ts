import { describe, expect, test } from "bun:test";
import {
	resolveConnectionToast,
	shouldShowConnectionToast,
} from "../../../src/frontend/browser/components/connection-toast.tsx";

describe("connection toast helpers", () => {
	test("does not show reconnect feedback before the first successful connection", () => {
		expect(shouldShowConnectionToast("connecting", false)).toBe(false);
		expect(shouldShowConnectionToast("disconnected", false)).toBe(false);
	});

	test("shows reconnect feedback after a prior successful connection", () => {
		expect(shouldShowConnectionToast("connecting", true)).toBe(true);
		expect(shouldShowConnectionToast("disconnected", true)).toBe(true);
		expect(shouldShowConnectionToast("connected", true)).toBe(false);
	});

	test("prefers the runtime error when disconnected", () => {
		expect(resolveConnectionToast("disconnected", "Socket closed")).toEqual({
			detail: "Socket closed",
			title: "Runtime disconnected",
		});
		expect(resolveConnectionToast("connecting", null)).toEqual({
			detail: "Trying to reconnect to the daemon.",
			title: "Reconnecting to runtime",
		});
	});
});
