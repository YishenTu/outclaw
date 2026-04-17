import { describe, expect, test } from "bun:test";
import {
	handleRuntimePopupKeydown,
	registerRuntimePopupShortcuts,
} from "../../../src/frontend/browser/components/chat/runtime-popup-shortcuts.ts";
import type { BrowserRuntimePopup } from "../../../src/frontend/browser/stores/runtime-popup.ts";

class KeydownEvent extends Event {
	readonly key: string;

	constructor(key: string) {
		super("keydown", { cancelable: true });
		this.key = key;
	}
}

const agentPopup: BrowserRuntimePopup = {
	kind: "agent",
	activeAgentId: "agent-alpha",
	activeAgentName: "alpha",
	agents: [
		{ agentId: "agent-alpha", name: "alpha" },
		{ agentId: "agent-beta", name: "beta" },
	],
};

describe("runtime popup shortcuts", () => {
	test("moves the highlighted runtime popup item with arrow keys", () => {
		let selectedIndex = 0;
		let prevented = false;
		let stopped = false;

		const handled = handleRuntimePopupKeydown(
			{
				key: "ArrowDown",
				preventDefault: () => {
					prevented = true;
				},
				stopPropagation: () => {
					stopped = true;
				},
			},
			agentPopup,
			{
				selectedIndex,
				setSelectedIndex: (nextIndex) => {
					selectedIndex = nextIndex;
				},
				selectIndex: () => {},
				closePopup: () => {},
			},
		);

		expect(handled).toBe(true);
		expect(selectedIndex).toBe(1);
		expect(prevented).toBe(true);
		expect(stopped).toBe(true);
	});

	test("selects the highlighted runtime popup item on Enter", () => {
		let selected = -1;
		let prevented = false;
		let stopped = false;

		const handled = handleRuntimePopupKeydown(
			{
				key: "Enter",
				preventDefault: () => {
					prevented = true;
				},
				stopPropagation: () => {
					stopped = true;
				},
			},
			agentPopup,
			{
				selectedIndex: 1,
				setSelectedIndex: () => {},
				selectIndex: (index) => {
					selected = index;
				},
				closePopup: () => {},
			},
		);

		expect(handled).toBe(true);
		expect(selected).toBe(1);
		expect(prevented).toBe(true);
		expect(stopped).toBe(true);
	});

	test("closes the popup on Escape", () => {
		let closed = false;
		let dismissed = false;
		let prevented = false;
		let stopped = false;

		const handled = handleRuntimePopupKeydown(
			{
				key: "Escape",
				preventDefault: () => {
					prevented = true;
				},
				stopPropagation: () => {
					stopped = true;
				},
			},
			agentPopup,
			{
				selectedIndex: 0,
				setSelectedIndex: () => {},
				selectIndex: () => {},
				closePopup: () => {
					closed = true;
				},
				onDismiss: () => {
					dismissed = true;
				},
			},
		);

		expect(handled).toBe(true);
		expect(closed).toBe(true);
		expect(dismissed).toBe(true);
		expect(prevented).toBe(true);
		expect(stopped).toBe(true);
	});

	test("registers and removes the global Escape listener", () => {
		let closedCount = 0;
		let selectedIndex = 0;
		const target = new EventTarget();
		const cleanup = registerRuntimePopupShortcuts(target, agentPopup, {
			selectedIndex,
			setSelectedIndex: (nextIndex) => {
				selectedIndex = nextIndex;
			},
			selectIndex: () => {},
			closePopup: () => {
				closedCount += 1;
			},
		});

		const downEvent = new KeydownEvent("ArrowDown");
		target.dispatchEvent(downEvent);

		const escapeEvent = new KeydownEvent("Escape");
		target.dispatchEvent(escapeEvent);

		expect(selectedIndex).toBe(1);
		expect(downEvent.defaultPrevented).toBe(true);
		expect(closedCount).toBe(1);
		expect(escapeEvent.defaultPrevented).toBe(true);

		cleanup();

		const secondEscapeEvent = new KeydownEvent("Escape");
		target.dispatchEvent(secondEscapeEvent);

		expect(closedCount).toBe(1);
		expect(secondEscapeEvent.defaultPrevented).toBe(false);
	});
});
