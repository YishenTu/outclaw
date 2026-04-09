import { describe, expect, test } from "bun:test";
import type { Key } from "ink";
import {
	applyCollapsedPasteKeypress,
	countLines,
	createCollapsedPasteDraft,
	createPasteAwareDraft,
	detectLargePasteInsertion,
	expandCollapsedPasteDraft,
	formatCollapsedPasteSummary,
	getCollapsedPasteDisplayCursor,
	getCollapsedPasteDisplayValue,
	LARGE_PASTE_LINE_THRESHOLD,
	shouldCollapseLargePaste,
} from "../../../../src/frontend/tui/composer/paste-draft.ts";

function key(overrides: Partial<Key> = {}): Key {
	return {
		upArrow: false,
		downArrow: false,
		leftArrow: false,
		rightArrow: false,
		pageDown: false,
		pageUp: false,
		home: false,
		end: false,
		return: false,
		escape: false,
		ctrl: false,
		shift: false,
		tab: false,
		backspace: false,
		delete: false,
		meta: false,
		super: false,
		hyper: false,
		capsLock: false,
		numLock: false,
		...overrides,
	};
}

describe("countLines", () => {
	test("returns 1 for an empty draft", () => {
		expect(countLines("")).toBe(1);
	});

	test("counts multiline content", () => {
		expect(countLines("a\nb\nc")).toBe(3);
	});
});

describe("shouldCollapseLargePaste", () => {
	test("collapses a large multi-line paste into an empty draft", () => {
		const pasted = Array.from(
			{ length: LARGE_PASTE_LINE_THRESHOLD + 1 },
			(_, index) => `line ${index + 1}`,
		).join("\n");

		expect(shouldCollapseLargePaste("", pasted)).toBe(
			LARGE_PASTE_LINE_THRESHOLD + 1,
		);
	});

	test("does not collapse normal typing", () => {
		expect(shouldCollapseLargePaste("", "a")).toBeNull();
		expect(shouldCollapseLargePaste("a", "ab")).toBeNull();
		expect(shouldCollapseLargePaste("a\nb", "a\nb\nc")).toBeNull();
	});

	test("does not collapse small pastes", () => {
		expect(shouldCollapseLargePaste("", "a\nb\nc")).toBeNull();
		expect(shouldCollapseLargePaste("", "a\nb\nc\nd")).toBe(4);
	});

	test("collapses large content appended to an existing draft", () => {
		const pasted = Array.from(
			{ length: LARGE_PASTE_LINE_THRESHOLD + 5 },
			(_, index) => `line ${index + 1}`,
		).join("\n");

		expect(shouldCollapseLargePaste("prefix", `prefix${pasted}`)).toBe(
			LARGE_PASTE_LINE_THRESHOLD + 5,
		);
	});
});

describe("detectLargePasteInsertion", () => {
	test("detects a large pasted insertion after existing text", () => {
		const pasted = Array.from(
			{ length: LARGE_PASTE_LINE_THRESHOLD + 2 },
			(_, index) => `line ${index + 1}`,
		).join("\n");

		expect(detectLargePasteInsertion("prefix ", `prefix ${pasted}`)).toEqual({
			insertEnd: `prefix ${pasted}`.length,
			insertStart: "prefix ".length,
			insertedText: pasted,
			lineCount: LARGE_PASTE_LINE_THRESHOLD + 2,
		});
	});

	test("detects a large pasted insertion in the middle of a draft", () => {
		const pasted = Array.from(
			{ length: LARGE_PASTE_LINE_THRESHOLD + 1 },
			(_, index) => `line ${index + 1}`,
		).join("\n");

		expect(
			detectLargePasteInsertion("before after", `before ${pasted} after`),
		).toEqual({
			insertEnd: `before ${pasted} `.length,
			insertStart: "before ".length,
			insertedText: `${pasted} `,
			lineCount: LARGE_PASTE_LINE_THRESHOLD + 1,
		});
	});
});

describe("formatCollapsedPasteSummary", () => {
	test("formats the compact summary text", () => {
		expect(formatCollapsedPasteSummary(20, 1)).toBe(
			"[pasted content #1: 20 lines]",
		);
	});
});

describe("applyCollapsedPasteKeypress", () => {
	test("creates a visible summary token and expands it on send", () => {
		const draft = createCollapsedPasteDraft("line1\nline2");

		expect(getCollapsedPasteDisplayValue(draft)).toBe(
			"[pasted content #1: 2 lines]",
		);
		expect(getCollapsedPasteDisplayCursor(draft)).toBe(
			formatCollapsedPasteSummary(2, 1).length,
		);
		expect(expandCollapsedPasteDraft(draft)).toBe("line1\nline2");
	});

	test("creates a summary placeholder inside surrounding text", () => {
		const draft = createCollapsedPasteDraft("line1\nline2", {
			prefix: "> ",
			suffix: " tail",
		});

		expect(getCollapsedPasteDisplayValue(draft)).toBe(
			"> [pasted content #1: 2 lines] tail",
		);
		expect(getCollapsedPasteDisplayCursor(draft)).toBe(
			"> [pasted content #1: 2 lines]".length,
		);
		expect(expandCollapsedPasteDraft(draft)).toBe("> line1\nline2 tail");
	});

	test("Enter submits the hidden full paste", () => {
		expect(
			applyCollapsedPasteKeypress(
				createCollapsedPasteDraft("line1\nline2"),
				"",
				key({ return: true }),
			),
		).toEqual({ type: "submit", value: "line1\nline2" });
	});

	test("Escape clears the collapsed paste", () => {
		expect(
			applyCollapsedPasteKeypress(
				createCollapsedPasteDraft("line1\nline2"),
				"",
				key({ escape: true }),
			),
		).toEqual({ type: "clear" });
	});

	test("typing appends visible text after the summary placeholder", () => {
		const action = applyCollapsedPasteKeypress(
			createCollapsedPasteDraft("line1\nline2"),
			"!",
			key(),
		);

		expect(action.type).toBe("update");
		if (action.type !== "update") {
			return;
		}
		expect(action.draft).toBeDefined();
		if (!action.draft) {
			return;
		}
		expect(getCollapsedPasteDisplayValue(action.draft)).toBe(
			"[pasted content #1: 2 lines]!",
		);
		expect(getCollapsedPasteDisplayCursor(action.draft)).toBe(
			formatCollapsedPasteSummary(2, 1).length + 1,
		);
		expect(expandCollapsedPasteDraft(action.draft)).toBe("line1\nline2!");
	});

	test("moving home and typing inserts before the summary placeholder", () => {
		const moved = applyCollapsedPasteKeypress(
			createCollapsedPasteDraft("line1\nline2"),
			"",
			key({ home: true }),
		);

		expect(moved.type).toBe("update");
		if (moved.type !== "update") {
			return;
		}
		expect(moved.draft).toBeDefined();
		if (!moved.draft) {
			return;
		}

		const inserted = applyCollapsedPasteKeypress(moved.draft, ">", key());
		expect(inserted.type).toBe("update");
		if (inserted.type !== "update") {
			return;
		}
		expect(inserted.draft).toBeDefined();
		if (!inserted.draft) {
			return;
		}
		expect(getCollapsedPasteDisplayValue(inserted.draft)).toBe(
			">[pasted content #1: 2 lines]",
		);
		expect(expandCollapsedPasteDraft(inserted.draft)).toBe(">line1\nline2");
	});

	test("editing inside the summary placeholder releases it back to plain text", () => {
		const action = applyCollapsedPasteKeypress(
			createCollapsedPasteDraft("line1\nline2"),
			"",
			key({ backspace: true }),
		);

		expect(action).toEqual({
			type: "update",
			draft: {
				value: "[pasted content #1: 2 lines",
				cursor: formatCollapsedPasteSummary(2, 1).length - 1,
				preferredColumn: null,
				placeholders: [],
			},
		});
	});

	test("deleting text before the placeholder keeps expansion semantics", () => {
		const draft = createCollapsedPasteDraft("line1\nline2");
		const moved = applyCollapsedPasteKeypress(draft, "", key({ home: true }));
		expect(moved.type).toBe("update");
		if (moved.type !== "update" || !moved.draft) {
			return;
		}

		const inserted = applyCollapsedPasteKeypress(moved.draft, ">", key());
		expect(inserted.type).toBe("update");
		if (inserted.type !== "update" || !inserted.draft) {
			return;
		}

		const action = applyCollapsedPasteKeypress(
			{ ...inserted.draft, cursor: 1 },
			"",
			key({ backspace: true }),
		);

		expect(action.type).toBe("update");
		if (action.type !== "update" || !action.draft) {
			return;
		}
		expect(getCollapsedPasteDisplayValue(action.draft)).toBe(
			"[pasted content #1: 2 lines]",
		);
		expect(expandCollapsedPasteDraft(action.draft)).toBe("line1\nline2");
	});

	test("legacy hidden-content editing no longer applies", () => {
		expect(
			applyCollapsedPasteKeypress(
				createCollapsedPasteDraft("hello"),
				"!",
				key(),
			),
		).not.toEqual({
			type: "update",
			value: "hello!",
			cursor: 6,
			lineCount: 1,
		});
	});

	test("collapses repeated large pastes into separate summary tokens", () => {
		const firstPaste = Array.from(
			{ length: 4 },
			(_, index) => `first ${index + 1}`,
		).join("\n");
		const secondPaste = Array.from(
			{ length: 5 },
			(_, index) => `second ${index + 1}`,
		).join("\n");

		const firstAction = applyCollapsedPasteKeypress(
			createPasteAwareDraft("prefix ", 7),
			firstPaste,
			key(),
		);
		expect(firstAction.type).toBe("update");
		if (firstAction.type !== "update" || !firstAction.draft) {
			return;
		}

		const typedTail = applyCollapsedPasteKeypress(
			firstAction.draft,
			" tail",
			key(),
		);
		expect(typedTail.type).toBe("update");
		if (typedTail.type !== "update" || !typedTail.draft) {
			return;
		}

		const secondAction = applyCollapsedPasteKeypress(
			typedTail.draft,
			secondPaste,
			key(),
		);
		expect(secondAction.type).toBe("update");
		if (secondAction.type !== "update" || !secondAction.draft) {
			return;
		}

		expect(getCollapsedPasteDisplayValue(secondAction.draft)).toBe(
			`prefix ${formatCollapsedPasteSummary(4, 1)} tail${formatCollapsedPasteSummary(5, 2)}`,
		);
		expect(secondAction.draft.placeholders).toHaveLength(2);
		expect(secondAction.draft.placeholders[0]?.pastedContent).toBe(firstPaste);
		expect(secondAction.draft.placeholders[1]?.pastedContent).toBe(secondPaste);
		expect(expandCollapsedPasteDraft(secondAction.draft)).toBe(
			`prefix ${firstPaste} tail${secondPaste}`,
		);
	});

	test("renumbers remaining placeholders after an earlier token is released", () => {
		const firstPaste = Array.from(
			{ length: 4 },
			(_, index) => `first ${index + 1}`,
		).join("\n");
		const secondPaste = Array.from(
			{ length: 5 },
			(_, index) => `second ${index + 1}`,
		).join("\n");

		const withFirstPaste = applyCollapsedPasteKeypress(
			createPasteAwareDraft("", 0),
			firstPaste,
			key(),
		);
		expect(withFirstPaste.type).toBe("update");
		if (withFirstPaste.type !== "update" || !withFirstPaste.draft) {
			return;
		}

		const withSpacer = applyCollapsedPasteKeypress(
			withFirstPaste.draft,
			" ",
			key(),
		);
		expect(withSpacer.type).toBe("update");
		if (withSpacer.type !== "update" || !withSpacer.draft) {
			return;
		}

		const withSecondPaste = applyCollapsedPasteKeypress(
			withSpacer.draft,
			secondPaste,
			key(),
		);
		expect(withSecondPaste.type).toBe("update");
		if (withSecondPaste.type !== "update" || !withSecondPaste.draft) {
			return;
		}

		const releasedFirstToken = applyCollapsedPasteKeypress(
			{
				...withSecondPaste.draft,
				cursor: formatCollapsedPasteSummary(4, 1).length,
			},
			"",
			key({ backspace: true }),
		);
		expect(releasedFirstToken.type).toBe("update");
		if (releasedFirstToken.type !== "update" || !releasedFirstToken.draft) {
			return;
		}

		expect(getCollapsedPasteDisplayValue(releasedFirstToken.draft)).toBe(
			"[pasted content #1: 4 lines [pasted content #1: 5 lines]",
		);
		expect(releasedFirstToken.draft.placeholders).toHaveLength(1);
		expect(expandCollapsedPasteDraft(releasedFirstToken.draft)).toBe(
			"[pasted content #1: 4 lines second 1\nsecond 2\nsecond 3\nsecond 4\nsecond 5",
		);
	});

	test("stores the exact pasted payload when collapsing a middle insertion", () => {
		const pasted = Array.from(
			{ length: 4 },
			(_, index) => `line ${index + 1}`,
		).join("\n");

		const action = applyCollapsedPasteKeypress(
			createPasteAwareDraft("before after", "before ".length),
			pasted,
			key(),
		);
		expect(action.type).toBe("update");
		if (action.type !== "update" || !action.draft) {
			return;
		}

		expect(action.draft.placeholders).toHaveLength(1);
		expect(action.draft.placeholders[0]?.pastedContent).toBe(pasted);
		expect(expandCollapsedPasteDraft(action.draft)).toBe(
			`before ${pasted}after`,
		);
	});
});
