import { describe, expect, test } from "bun:test";
import {
	clearDispatchedTerminalRunRequest,
	createTerminalRunRequest,
	storeTerminalRunRequest,
} from "../../../src/frontend/browser/components/right-panel/terminal/terminal-run-coordinator.ts";

describe("terminal run coordinator", () => {
	test("creates monotonic run requests", () => {
		const { nextRequestId, request } = createTerminalRunRequest({
			command: "bun test",
			nextRequestId: 2,
		});

		expect(nextRequestId).toBe(3);
		expect(request).toEqual({
			command: "bun test",
			id: 3,
		});
	});

	test("stores and clears only the dispatched request for the active agent", () => {
		const current = storeTerminalRunRequest({}, "agent-a", {
			command: "bun test",
			id: 1,
		});
		const staleClear = clearDispatchedTerminalRunRequest(current, "agent-a", 2);

		expect(staleClear).toBe(current);
		expect(clearDispatchedTerminalRunRequest(current, "agent-a", 1)).toEqual(
			{},
		);
	});
});
