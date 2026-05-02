import { describe, expect, test } from "bun:test";
import { copyTextToClipboard } from "../../../src/frontend/browser/clipboard/copy-text-to-clipboard.ts";

describe("copyTextToClipboard", () => {
	test("uses the Clipboard API in secure contexts", async () => {
		let writtenText: string | undefined;

		const copied = await copyTextToClipboard("local copy", {
			isSecureContext: true,
			navigator: {
				clipboard: {
					writeText: async (value) => {
						writtenText = value;
					},
				},
			},
		});

		expect(copied).toBe(true);
		expect(writtenText).toBe("local copy");
	});

	test("falls back to textarea selection on insecure LAN origins", async () => {
		const fallback = createFallbackDocument({ execResult: true });

		const copied = await copyTextToClipboard("lan copy", {
			document: fallback.document,
			isSecureContext: false,
			navigator: {},
		});

		expect(copied).toBe(true);
		expect(fallback.textarea?.value).toBe("lan copy");
		expect(fallback.state.appended).toBe(true);
		expect(fallback.state.focused).toBe(true);
		expect(fallback.state.selected).toBe(true);
		expect(fallback.state.selectionRange).toEqual([0, "lan copy".length]);
		expect(fallback.state.commands).toEqual(["copy"]);
		expect(fallback.state.removed).toBe(true);
		expect(fallback.state.restoredFocus).toBe(true);
	});

	test("falls back when the Clipboard API rejects", async () => {
		const fallback = createFallbackDocument({ execResult: true });

		const copied = await copyTextToClipboard("permission fallback", {
			document: fallback.document,
			isSecureContext: true,
			navigator: {
				clipboard: {
					writeText: async () => {
						throw new Error("denied");
					},
				},
			},
		});

		expect(copied).toBe(true);
		expect(fallback.state.commands).toEqual(["copy"]);
	});

	test("reports failure when no copy path succeeds", async () => {
		const copied = await copyTextToClipboard("cannot copy", {
			isSecureContext: true,
			navigator: {
				clipboard: {
					writeText: async () => {
						throw new Error("denied");
					},
				},
			},
		});

		expect(copied).toBe(false);
	});
});

interface FallbackState {
	appended: boolean;
	commands: string[];
	focused: boolean;
	removed: boolean;
	restoredFocus: boolean;
	selected: boolean;
	selectionRange?: [number, number];
}

interface FakeTextArea {
	parentNode?: { removeChild: (element: FakeTextArea) => FakeTextArea };
	readOnly: boolean;
	style: Partial<CSSStyleDeclaration>;
	value: string;
	focus: () => void;
	select: () => void;
	setAttribute: (name: string, value: string) => void;
	setSelectionRange: (start: number, end: number) => void;
}

function createFallbackDocument({ execResult }: { execResult: boolean }) {
	const state: FallbackState = {
		appended: false,
		commands: [],
		focused: false,
		removed: false,
		restoredFocus: false,
		selected: false,
	};
	let textarea: FakeTextArea | undefined;

	const body = {
		appendChild(element: FakeTextArea) {
			state.appended = true;
			element.parentNode = body;
			return element;
		},
		removeChild(element: FakeTextArea) {
			state.removed = true;
			return element;
		},
	};

	return {
		get textarea() {
			return textarea;
		},
		state,
		document: {
			activeElement: {
				focus: () => {
					state.restoredFocus = true;
				},
			},
			body,
			createElement(tagName: string) {
				expect(tagName).toBe("textarea");
				textarea = {
					readOnly: false,
					style: {},
					value: "",
					focus: () => {
						state.focused = true;
					},
					select: () => {
						state.selected = true;
					},
					setAttribute: () => {},
					setSelectionRange: (start, end) => {
						state.selectionRange = [start, end];
					},
				};
				return textarea;
			},
			execCommand(command: string) {
				state.commands.push(command);
				return execResult;
			},
		},
	};
}
