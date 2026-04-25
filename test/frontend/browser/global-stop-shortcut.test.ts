import { describe, expect, test } from "bun:test";
import {
	handleGlobalStopKeydown,
	registerGlobalStopShortcut,
} from "../../../src/frontend/browser/components/chat/global-stop-shortcut.ts";

class KeydownEvent extends Event {
	readonly key: string;

	constructor(key: string, target?: EventTarget | null) {
		super("keydown", { cancelable: true });
		this.key = key;
		if (target !== undefined) {
			Object.defineProperty(this, "target", {
				configurable: true,
				value: target,
			});
		}
	}
}

describe("browser global stop shortcut", () => {
	test("sends /stop on Escape when the shortcut is enabled", () => {
		let stopped = false;
		let prevented = false;

		const handled = handleGlobalStopKeydown(
			{
				key: "Escape",
				target: {
					tagName: "BUTTON",
					closest: () => null,
				},
				preventDefault: () => {
					prevented = true;
				},
			},
			true,
			() => {
				stopped = true;
				return true;
			},
		);

		expect(handled).toBe(true);
		expect(stopped).toBe(true);
		expect(prevented).toBe(true);
	});

	test("ignores Escape inside editable fields", () => {
		let stopped = false;

		const handled = handleGlobalStopKeydown(
			{
				key: "Escape",
				target: {
					tagName: "INPUT",
					type: "text",
					closest: () => null,
				},
				preventDefault: () => {},
			},
			true,
			() => {
				stopped = true;
				return true;
			},
		);

		expect(handled).toBe(false);
		expect(stopped).toBe(false);
	});

	test("ignores Escape for dialog interactions", () => {
		let stopped = false;

		const handled = handleGlobalStopKeydown(
			{
				key: "Escape",
				target: {
					tagName: "BUTTON",
					closest: (selector: string) =>
						selector === '[role="dialog"], [aria-modal="true"]' ? {} : null,
				},
				preventDefault: () => {},
			},
			true,
			() => {
				stopped = true;
				return true;
			},
		);

		expect(handled).toBe(false);
		expect(stopped).toBe(false);
	});

	test("ignores events that were already handled locally", () => {
		let stopped = false;
		const event = new KeydownEvent("Escape");
		event.preventDefault();

		const handled = handleGlobalStopKeydown(event, true, () => {
			stopped = true;
			return true;
		});

		expect(handled).toBe(false);
		expect(stopped).toBe(false);
	});

	test("registers and removes the global Escape listener", () => {
		let stopCount = 0;
		const target = new EventTarget();
		const cleanup = registerGlobalStopShortcut(target, true, () => {
			stopCount += 1;
			return true;
		});

		const escapeEvent = new KeydownEvent("Escape");
		target.dispatchEvent(escapeEvent);

		expect(stopCount).toBe(1);
		expect(escapeEvent.defaultPrevented).toBe(true);

		cleanup();

		const secondEscapeEvent = new KeydownEvent("Escape");
		target.dispatchEvent(secondEscapeEvent);

		expect(stopCount).toBe(1);
		expect(secondEscapeEvent.defaultPrevented).toBe(false);
	});
});
