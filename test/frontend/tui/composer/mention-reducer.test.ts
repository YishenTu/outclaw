import { describe, expect, test } from "bun:test";
import type { Key } from "ink";
import type { WorkspaceFileEntry } from "../../../../src/common/protocol.ts";
import type { TextAreaInputEvent } from "../../../../src/frontend/tui/composer/input.ts";
import { createPasteAwareDraft } from "../../../../src/frontend/tui/composer/paste-draft.ts";
import {
	createComposerState,
	reduceComposerBatch,
} from "../../../../src/frontend/tui/composer/state.ts";

const FILES: WorkspaceFileEntry[] = [
	{ kind: "file", path: "README.md" },
	{ kind: "directory", path: "src" },
	{ kind: "file", path: "src/index.ts" },
	{ kind: "file", path: "src/runtime/agent.ts" },
];

function event(
	overrides: Partial<TextAreaInputEvent> = {},
): TextAreaInputEvent {
	return {
		input: "",
		sequence: "",
		key: emptyKey(),
		...overrides,
	};
}

function emptyKey(overrides: Partial<Key> = {}): Key {
	return {
		upArrow: false,
		downArrow: false,
		leftArrow: false,
		rightArrow: false,
		return: false,
		escape: false,
		ctrl: false,
		shift: false,
		tab: false,
		backspace: false,
		delete: false,
		pageDown: false,
		pageUp: false,
		meta: false,
		home: false,
		end: false,
		super: false,
		hyper: false,
		capsLock: false,
		numLock: false,
		...overrides,
	};
}

function withDraft(value: string, cursor = value.length) {
	const state = createComposerState();
	return { ...state, draft: createPasteAwareDraft(value, cursor) };
}

describe("composer reducer with mention menu", () => {
	test("Tab inserts the selected mention path with trailing space", () => {
		const state = withDraft("see @ind");
		const result = reduceComposerBatch(
			state,
			[event({ key: emptyKey({ tab: true }) })],
			{
				inputActive: true,
				skills: [],
				workspaceFiles: FILES,
			},
		);

		expect(result.effect).toEqual({ type: "none" });
		expect(result.state.draft.value).toBe("see @src/index.ts ");
		expect(result.state.draft.cursor).toBe("see @src/index.ts ".length);
	});

	test("ArrowDown advances mention selection", () => {
		const state = withDraft("@");
		const result = reduceComposerBatch(
			state,
			[event({ key: emptyKey({ downArrow: true }) })],
			{
				inputActive: true,
				skills: [],
				workspaceFiles: FILES,
			},
		);
		expect(result.state.mentionMenuIndex).toBe(1);
	});

	test("Escape dismisses the mention menu without changing the draft", () => {
		const state = withDraft("@sr");
		const result = reduceComposerBatch(
			state,
			[event({ key: emptyKey({ escape: true }) })],
			{
				inputActive: true,
				skills: [],
				workspaceFiles: FILES,
			},
		);
		expect(result.state.mentionMenuDismissed).toBe(true);
		expect(result.state.draft.value).toBe("@sr");
	});

	test("notifies onMentionTokenActive while typing inside an @-token", () => {
		const state = withDraft("@s");
		let calls = 0;
		reduceComposerBatch(state, [event()], {
			inputActive: true,
			skills: [],
			workspaceFiles: FILES,
			onMentionTokenActive: () => {
				calls += 1;
			},
		});
		expect(calls).toBeGreaterThan(0);
	});

	test("typing characters into an @-token clears the mention menu dismissal", () => {
		const dismissedState = withDraft("@");
		const escaped = reduceComposerBatch(
			dismissedState,
			[event({ key: emptyKey({ escape: true }) })],
			{
				inputActive: true,
				skills: [],
				workspaceFiles: FILES,
			},
		);
		expect(escaped.state.mentionMenuDismissed).toBe(true);

		const typed = reduceComposerBatch(
			escaped.state,
			[event({ input: "s", sequence: "s" })],
			{
				inputActive: true,
				skills: [],
				workspaceFiles: FILES,
			},
		);
		expect(typed.state.mentionMenuDismissed).toBe(false);
		expect(typed.state.draft.value).toBe("@s");
	});
});
