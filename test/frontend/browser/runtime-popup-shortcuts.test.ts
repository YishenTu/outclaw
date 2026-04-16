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
	agents: [{ agentId: "agent-alpha", name: "alpha" }],
};

describe("runtime popup shortcuts", () => {
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
			() => {
				closed = true;
			},
			() => {
				dismissed = true;
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
		const target = new EventTarget();
		const cleanup = registerRuntimePopupShortcuts(target, agentPopup, () => {
			closedCount += 1;
		});

		const escapeEvent = new KeydownEvent("Escape");
		target.dispatchEvent(escapeEvent);

		expect(closedCount).toBe(1);
		expect(escapeEvent.defaultPrevented).toBe(true);

		cleanup();

		const secondEscapeEvent = new KeydownEvent("Escape");
		target.dispatchEvent(secondEscapeEvent);

		expect(closedCount).toBe(1);
		expect(secondEscapeEvent.defaultPrevented).toBe(false);
	});
});
