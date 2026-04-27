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

	test("createTerminal works without crypto.randomUUID", () => {
		const originalCrypto = globalThis.crypto;
		Object.defineProperty(globalThis, "crypto", {
			configurable: true,
			value: {
				getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
			},
			writable: true,
		});

		try {
			const terminalId = store.getState().createTerminal("agent-a", {
				now: 123,
			});

			expect(terminalId).toStartWith("agent-a-terminal-1-");
			expect(store.getState().activeTerminalIdByAgent["agent-a"]).toBe(
				terminalId,
			);
		} finally {
			Object.defineProperty(globalThis, "crypto", {
				configurable: true,
				value: originalCrypto,
				writable: true,
			});
		}
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

	test("closeTerminal replaces the final terminal with a fresh active terminal", () => {
		const closedTerminalId = store.getState().ensureTerminal("agent-a", {
			now: 100,
		});

		store.getState().closeTerminal("agent-a", closedTerminalId);

		const terminals = store.getState().terminalsByAgent["agent-a"] ?? [];
		expect(terminals).toHaveLength(1);
		expect(terminals[0]?.id).not.toBe(closedTerminalId);
		expect(terminals[0]?.name).toBe("Terminal");
		expect(store.getState().activeTerminalIdByAgent["agent-a"]).toBe(
			terminals[0]?.id,
		);
	});

	test("closeTerminal normalizes a remaining default singleton name", () => {
		const firstTerminalId = store.getState().ensureTerminal("agent-a");
		const secondTerminalId = store.getState().createTerminal("agent-a");

		store.getState().closeTerminal("agent-a", firstTerminalId);

		expect(
			store.getState().terminalsByAgent["agent-a"]?.map((terminal) => ({
				id: terminal.id,
				name: terminal.name,
			})),
		).toEqual([{ id: secondTerminalId, name: "Terminal" }]);
	});

	test("createTerminal uses the next available default display name", () => {
		const closedTerminalId = store.getState().ensureTerminal("agent-a");

		store.getState().closeTerminal("agent-a", closedTerminalId);
		store.getState().createTerminal("agent-a");

		expect(
			getTerminalNames(store.getState().terminalsByAgent["agent-a"]),
		).toEqual(["Terminal", "Terminal 2"]);
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
