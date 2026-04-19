import { describe, expect, test } from "bun:test";
import { createSidebarRefreshGate } from "../../../src/frontend/browser/sidebar-refresh-gate.ts";

describe("sidebar refresh gate", () => {
	test("accepts only the latest started request", () => {
		const gate = createSidebarRefreshGate();

		const firstRequest = gate.startRequest();
		const secondRequest = gate.startRequest();

		expect(gate.isCurrent(firstRequest)).toBe(false);
		expect(gate.isCurrent(secondRequest)).toBe(true);
	});

	test("invalidating the gate retires in-flight requests", () => {
		const gate = createSidebarRefreshGate();

		const request = gate.startRequest();
		gate.invalidate();

		expect(gate.isCurrent(request)).toBe(false);
	});
});
