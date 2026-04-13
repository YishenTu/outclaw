import { describe, expect, test } from "bun:test";
import { createPasteAwareDraft } from "../../../src/frontend/tui/composer/paste-draft.ts";
import { startTui } from "../../../src/frontend/tui/index.tsx";
import { formatSessionMenuItem } from "../../../src/frontend/tui/sessions/format.ts";
import {
	applyAction,
	type TuiAction,
} from "../../../src/frontend/tui/transcript/reducer.ts";
import { mapEventToActions } from "../../../src/frontend/tui/transcript/runtime-events.ts";
import { initialTuiState } from "../../../src/frontend/tui/transcript/state.ts";

describe("TUI architecture", () => {
	test("exports the directory entrypoint", () => {
		expect(typeof startTui).toBe("function");
	});

	test("keeps transcript state in the transcript boundary", () => {
		expect(initialTuiState()).toEqual({
			messages: [],
			streaming: "",
			streamingThinking: "",
			running: false,
			compacting: false,
			nextId: 1,
		});
	});

	test("keeps runtime-event mapping separate from transcript reduction", () => {
		const actions = mapEventToActions({ type: "text", text: "hello" });
		expect(actions).toHaveLength(1);
		expect(actions).toEqual([{ type: "append_streaming", text: "hello" }]);
		expect(applyAction(initialTuiState(), actions[0] as TuiAction)).toEqual({
			messages: [],
			streaming: "hello",
			streamingThinking: "",
			running: true,
			compacting: false,
			nextId: 1,
		});
	});

	test("keeps session menu formatting in the sessions boundary", () => {
		expect(
			formatSessionMenuItem(
				{
					sdkSessionId: "sdk-1",
					title: "Chat A",
					model: "opus",
					lastActive: Date.now() - 60_000,
					active: true,
				},
				30,
			),
		).toHaveLength(30);
	});

	test("keeps paste-aware draft state in the composer boundary", () => {
		expect(createPasteAwareDraft()).toEqual({
			value: "",
			cursor: 0,
			preferredColumn: null,
			placeholders: [],
		});
	});
});
