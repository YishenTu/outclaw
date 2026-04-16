import type { SkillInfo } from "../../../common/protocol.ts";
import { matchCommands } from "../command-menu/state.ts";
import { clampSelectionIndex, moveWrappedSelection } from "../selection.ts";
import type { TextAreaInputEvent } from "./input.ts";
import {
	applyCollapsedPasteKeypress,
	type CollapsedPasteDraft,
	createPasteAwareDraft,
} from "./paste-draft.ts";

export interface ComposerState {
	draft: CollapsedPasteDraft;
	cmdMenuIndex: number;
	cmdMenuDismissed: boolean;
}

export interface ComposerBatchOptions {
	inputActive: boolean;
	skills: SkillInfo[];
}

export type ComposerBatchEffect =
	| { type: "none" }
	| { type: "submit"; value: string };

export interface ComposerBatchResult {
	effect: ComposerBatchEffect;
	state: ComposerState;
}

export function createComposerState(): ComposerState {
	return {
		draft: createPasteAwareDraft(),
		cmdMenuIndex: 0,
		cmdMenuDismissed: false,
	};
}

export function withComposerDraft(
	state: ComposerState,
	draft: CollapsedPasteDraft,
): ComposerState {
	return {
		...state,
		draft,
		cmdMenuIndex: 0,
		cmdMenuDismissed: false,
	};
}

export function clampCommandMenuIndex(index: number, count: number): number {
	return clampSelectionIndex(index, count);
}

function normalizeComposerState(
	state: ComposerState,
	options: ComposerBatchOptions,
): ComposerState {
	const matchedCommands = matchCommands(state.draft.value, options.skills);
	const nextIndex = clampCommandMenuIndex(
		state.cmdMenuIndex,
		matchedCommands.length,
	);
	if (nextIndex === state.cmdMenuIndex) {
		return state;
	}

	return {
		...state,
		cmdMenuIndex: nextIndex,
	};
}

export function reduceComposerBatch(
	state: ComposerState,
	events: TextAreaInputEvent[],
	options: ComposerBatchOptions,
): ComposerBatchResult {
	let nextState = normalizeComposerState(state, options);

	for (const { input, key, sequence } of events) {
		const matchedCommands = matchCommands(
			nextState.draft.value,
			options.skills,
		);
		const cmdMenuVisible =
			options.inputActive &&
			matchedCommands.length > 0 &&
			!nextState.cmdMenuDismissed;

		if (cmdMenuVisible) {
			if (key.upArrow || (key.ctrl && input === "p")) {
				nextState = {
					...nextState,
					cmdMenuIndex: moveWrappedSelection(
						nextState.cmdMenuIndex,
						matchedCommands.length,
						-1,
					),
				};
				continue;
			}

			if (key.downArrow || (key.ctrl && input === "n")) {
				nextState = {
					...nextState,
					cmdMenuIndex: moveWrappedSelection(
						nextState.cmdMenuIndex,
						matchedCommands.length,
						1,
					),
				};
				continue;
			}

			if (key.tab || key.return) {
				const selected = matchedCommands[nextState.cmdMenuIndex];
				if (!selected) {
					return { effect: { type: "none" }, state: nextState };
				}

				const filled = `${selected.command} `;
				return {
					effect: { type: "none" },
					state: withComposerDraft(
						nextState,
						createPasteAwareDraft(filled, filled.length),
					),
				};
			}

			if (key.escape) {
				return {
					effect: { type: "none" },
					state: {
						...nextState,
						cmdMenuDismissed: true,
					},
				};
			}
		}

		const action = applyCollapsedPasteKeypress(
			nextState.draft,
			input,
			key,
			sequence,
		);
		if (action.type === "ignore") {
			continue;
		}
		if (action.type === "clear") {
			return {
				effect: { type: "none" },
				state: createComposerState(),
			};
		}
		if (action.type === "submit") {
			return {
				effect: {
					type: "submit",
					value: action.value ?? nextState.draft.value,
				},
				state: nextState,
			};
		}
		if (action.type === "update" && action.draft) {
			nextState = withComposerDraft(nextState, action.draft);
		}
	}

	return {
		effect: { type: "none" },
		state: nextState,
	};
}
