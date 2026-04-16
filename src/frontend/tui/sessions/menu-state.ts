import type { TextAreaInputEvent } from "../composer/input.ts";
import { clampSelectionIndex, moveWrappedSelection } from "../selection.ts";
import type { SessionMenuChoice } from "./types.ts";

export interface SessionMenuState {
	cursor: number;
	renaming: boolean;
	renameValue: string;
}

export type SessionMenuEffect =
	| { type: "none" }
	| { type: "delete"; choice: SessionMenuChoice }
	| { type: "dismiss" }
	| { type: "select"; choice: SessionMenuChoice };

export interface SessionMenuBatchResult {
	effect: SessionMenuEffect;
	state: SessionMenuState;
}

export function createSessionMenuState(): SessionMenuState {
	return {
		cursor: 0,
		renaming: false,
		renameValue: "",
	};
}

export function normalizeSessionMenuState(
	state: SessionMenuState,
	choices: SessionMenuChoice[],
): SessionMenuState {
	const nextCursor = clampSelectionIndex(state.cursor, choices.length);
	const nextRenaming = choices.length > 0 ? state.renaming : false;

	if (nextCursor === state.cursor && nextRenaming === state.renaming) {
		return state;
	}

	return {
		...state,
		cursor: nextCursor,
		renaming: nextRenaming,
	};
}

export function reduceSessionMenuBatch(
	state: SessionMenuState,
	events: TextAreaInputEvent[],
	choices: SessionMenuChoice[],
): SessionMenuBatchResult {
	let nextState = normalizeSessionMenuState(state, choices);

	for (const { input, key } of events) {
		if (choices.length === 0) {
			if (key.escape) {
				return { state: nextState, effect: { type: "dismiss" } };
			}

			return { state: nextState, effect: { type: "none" } };
		}

		if (key.escape) {
			return { state: nextState, effect: { type: "dismiss" } };
		}

		const choice = choices[nextState.cursor];
		if (!choice) {
			return { state: nextState, effect: { type: "none" } };
		}

		if (key.return) {
			return { state: nextState, effect: { type: "select", choice } };
		}

		if (input === "d") {
			return { state: nextState, effect: { type: "delete", choice } };
		}

		if (input === "r") {
			return {
				effect: { type: "none" },
				state: {
					...nextState,
					renaming: true,
					renameValue: choice.title,
				},
			};
		}

		if (key.upArrow) {
			nextState = {
				...nextState,
				cursor: moveWrappedSelection(nextState.cursor, choices.length, -1),
			};
		}

		if (key.downArrow) {
			nextState = {
				...nextState,
				cursor: moveWrappedSelection(nextState.cursor, choices.length, 1),
			};
		}
	}

	return { state: nextState, effect: { type: "none" } };
}
