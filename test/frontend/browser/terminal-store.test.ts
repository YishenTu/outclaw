import { beforeEach, describe, expect, test } from "bun:test";
import {
	type BrowserTerminalEntry,
	createTerminalStore,
} from "../../../src/frontend/browser/stores/terminal.ts";

function getTerminalNames(entries: BrowserTerminalEntry[] | undefined) {
	return (entries ?? []).map((entry) => entry.name);
}

describe("browser terminal store", () => {
	let store: ReturnType<typeof createTerminalStore>;

	beforeEach(() => {
		store = createTerminalStore();
	});

	test("ensureTerminal creates the first terminal once per agent", () => {
		const firstTerminalId = store.getState().ensureTerminal("agent-a");
		const secondTerminalId = store.getState().ensureTerminal("agent-a");

		expect(secondTerminalId).toBe(firstTerminalId);
		expect(
			getTerminalNames(store.getState().terminalsByAgent["agent-a"]),
		).toEqual(["Terminal"]);
		expect(store.getState().activeTerminalIdByAgent["agent-a"]).toBe(
			firstTerminalId,
		);
	});

	test("createTerminal appends a new active terminal for the current agent", () => {
		store.getState().ensureTerminal("agent-a");
		const nextTerminalId = store.getState().createTerminal("agent-a");

		expect(
			getTerminalNames(store.getState().terminalsByAgent["agent-a"]),
		).toEqual(["Terminal", "Terminal 2"]);
		expect(store.getState().activeTerminalIdByAgent["agent-a"]).toBe(
			nextTerminalId,
		);
	});

	test("closeTerminal promotes the previous terminal when closing the active one", () => {
		const firstTerminalId = store.getState().ensureTerminal("agent-a");
		const secondTerminalId = store.getState().createTerminal("agent-a");
		const thirdTerminalId = store.getState().createTerminal("agent-a");

		store.getState().setActiveTerminal("agent-a", secondTerminalId);
		store.getState().closeTerminal("agent-a", secondTerminalId);

		expect(
			store
				.getState()
				.terminalsByAgent["agent-a"]?.map((terminal) => terminal.id),
		).toEqual([firstTerminalId, thirdTerminalId]);
		expect(store.getState().activeTerminalIdByAgent["agent-a"]).toBe(
			firstTerminalId,
		);
	});

	test("terminal numbering and activation stay scoped per agent", () => {
		store.getState().ensureTerminal("agent-a");
		store.getState().createTerminal("agent-a");
		const agentBTerminalId = store.getState().ensureTerminal("agent-b");

		expect(
			getTerminalNames(store.getState().terminalsByAgent["agent-a"]),
		).toEqual(["Terminal", "Terminal 2"]);
		expect(
			getTerminalNames(store.getState().terminalsByAgent["agent-b"]),
		).toEqual(["Terminal"]);
		expect(store.getState().activeTerminalIdByAgent["agent-b"]).toBe(
			agentBTerminalId,
		);
	});

	test("renameTerminal updates the matching terminal name and ignores blank names", () => {
		const terminalId = store.getState().ensureTerminal("agent-a");

		store.getState().renameTerminal("agent-a", terminalId, "  Build Shell  ");
		expect(
			getTerminalNames(store.getState().terminalsByAgent["agent-a"]),
		).toEqual(["Build Shell"]);

		store.getState().renameTerminal("agent-a", terminalId, "   ");
		expect(
			getTerminalNames(store.getState().terminalsByAgent["agent-a"]),
		).toEqual(["Build Shell"]);
	});
});
