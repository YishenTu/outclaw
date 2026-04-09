import type { Key } from "ink";
import {
	deleteBack,
	deleteForward,
	deleteWordBack,
	deleteWordForward,
	getCursorColumn,
	insertAt,
	killToLineEnd,
	killToLineStart,
	moveHorizontal,
	moveToLineEnd,
	moveToLineStart,
	moveVertical,
	moveWordBack,
	moveWordForward,
} from "./edit.ts";

export interface TextAreaState {
	preferredColumn?: number | null;
	value: string;
	cursor: number;
}

export interface TextAreaChange {
	start: number;
	end: number;
	text: string;
}

export interface TextAreaKeypressResult extends TextAreaState {
	change?: TextAreaChange;
	handled: boolean;
	preferredColumn: number | null;
	submit: boolean;
}

function normalizeInsertedText(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isBackwardDeleteSequence(sequence?: string): boolean {
	return sequence === "\x7f" || sequence === "\x1b\x7f";
}

function move(state: TextAreaState, cursor: number): TextAreaKeypressResult {
	return {
		value: state.value,
		cursor,
		preferredColumn: null,
		handled: true,
		submit: false,
	};
}

function moveVerticalWithPreference(
	state: TextAreaState,
	delta: -1 | 1,
): TextAreaKeypressResult {
	const preferredColumn =
		state.preferredColumn ?? getCursorColumn(state.value, state.cursor);
	return {
		value: state.value,
		cursor: moveVertical(state.value, state.cursor, delta, preferredColumn),
		preferredColumn,
		handled: true,
		submit: false,
	};
}

function edit(
	value: string,
	cursor: number,
	change?: TextAreaChange,
): TextAreaKeypressResult {
	return {
		value,
		cursor,
		change,
		preferredColumn: null,
		handled: true,
		submit: false,
	};
}

function ignore(state: TextAreaState): TextAreaKeypressResult {
	return {
		value: state.value,
		cursor: state.cursor,
		preferredColumn: state.preferredColumn ?? null,
		handled: true,
		submit: false,
	};
}

function noop(state: TextAreaState): TextAreaKeypressResult {
	return {
		value: state.value,
		cursor: state.cursor,
		preferredColumn: state.preferredColumn ?? null,
		handled: false,
		submit: false,
	};
}

function submit(state: TextAreaState): TextAreaKeypressResult {
	return {
		value: state.value,
		cursor: state.cursor,
		preferredColumn: state.preferredColumn ?? null,
		handled: true,
		submit: true,
	};
}

function backwardDeleteChange(
	state: TextAreaState,
	result: { value: string; cursor: number },
): TextAreaChange | undefined {
	if (result.value === state.value && result.cursor === state.cursor) {
		return undefined;
	}
	return {
		start: result.cursor,
		end: state.cursor,
		text: "",
	};
}

function forwardDeleteChange(
	state: TextAreaState,
	result: { value: string; cursor: number },
): TextAreaChange | undefined {
	if (result.value === state.value && result.cursor === state.cursor) {
		return undefined;
	}
	return {
		start: state.cursor,
		end: state.cursor + (state.value.length - result.value.length),
		text: "",
	};
}

export function applyTextAreaKeypress(
	state: TextAreaState,
	input: string,
	key: Key,
	sequence?: string,
): TextAreaKeypressResult {
	if (key.upArrow || (key.ctrl && input === "p")) {
		return moveVerticalWithPreference(state, -1);
	}
	if (key.downArrow || (key.ctrl && input === "n")) {
		return moveVerticalWithPreference(state, 1);
	}
	if (key.leftArrow && (key.ctrl || key.meta)) {
		return move(state, moveWordBack(state.value, state.cursor));
	}
	if (key.rightArrow && (key.ctrl || key.meta)) {
		return move(state, moveWordForward(state.value, state.cursor));
	}
	if (key.leftArrow || (key.ctrl && input === "b")) {
		return move(state, moveHorizontal(state.value, state.cursor, -1));
	}
	if (key.rightArrow || (key.ctrl && input === "f")) {
		return move(state, moveHorizontal(state.value, state.cursor, 1));
	}
	if (key.home || (key.ctrl && input === "a")) {
		return move(state, moveToLineStart(state.value, state.cursor));
	}
	if (key.end || (key.ctrl && input === "e")) {
		return move(state, moveToLineEnd(state.value, state.cursor));
	}
	if (key.meta && key.backspace) {
		const result = deleteWordBack(state.value, state.cursor);
		return edit(
			result.value,
			result.cursor,
			backwardDeleteChange(state, result),
		);
	}
	if (key.meta && key.delete && isBackwardDeleteSequence(sequence)) {
		const result = deleteWordBack(state.value, state.cursor);
		return edit(
			result.value,
			result.cursor,
			backwardDeleteChange(state, result),
		);
	}
	if (key.meta && key.delete) {
		const result = deleteWordForward(state.value, state.cursor);
		return edit(
			result.value,
			result.cursor,
			forwardDeleteChange(state, result),
		);
	}
	if (key.meta) {
		switch (input) {
			case "b":
				return move(state, moveWordBack(state.value, state.cursor));
			case "f":
				return move(state, moveWordForward(state.value, state.cursor));
			case "d": {
				const result = deleteWordForward(state.value, state.cursor);
				return edit(
					result.value,
					result.cursor,
					forwardDeleteChange(state, result),
				);
			}
		}
	}
	if (key.ctrl) {
		switch (input) {
			case "u": {
				const result = killToLineStart(state.value, state.cursor);
				return edit(
					result.value,
					result.cursor,
					backwardDeleteChange(state, result),
				);
			}
			case "k": {
				const result = killToLineEnd(state.value, state.cursor);
				return edit(
					result.value,
					result.cursor,
					forwardDeleteChange(state, result),
				);
			}
			case "w": {
				const result = deleteWordBack(state.value, state.cursor);
				return edit(
					result.value,
					result.cursor,
					backwardDeleteChange(state, result),
				);
			}
			case "d": {
				const result = deleteForward(state.value, state.cursor);
				return edit(
					result.value,
					result.cursor,
					forwardDeleteChange(state, result),
				);
			}
			case "h": {
				const result = deleteBack(state.value, state.cursor);
				return edit(
					result.value,
					result.cursor,
					backwardDeleteChange(state, result),
				);
			}
			case "j": {
				return edit(
					insertAt(state.value, state.cursor, "\n").value,
					state.cursor + 1,
					{
						start: state.cursor,
						end: state.cursor,
						text: "\n",
					},
				);
			}
		}
	}
	if (key.return && (key.shift || key.meta)) {
		return edit(
			insertAt(state.value, state.cursor, "\n").value,
			state.cursor + 1,
			{
				start: state.cursor,
				end: state.cursor,
				text: "\n",
			},
		);
	}
	if (key.return) {
		return submit(state);
	}
	if (key.backspace) {
		const result = deleteBack(state.value, state.cursor);
		return edit(
			result.value,
			result.cursor,
			backwardDeleteChange(state, result),
		);
	}
	if (key.delete && isBackwardDeleteSequence(sequence)) {
		const result = deleteBack(state.value, state.cursor);
		return edit(
			result.value,
			result.cursor,
			backwardDeleteChange(state, result),
		);
	}
	if (key.delete) {
		const result = deleteForward(state.value, state.cursor);
		return edit(
			result.value,
			result.cursor,
			forwardDeleteChange(state, result),
		);
	}
	if (key.tab || key.escape) {
		return ignore(state);
	}
	if (input.length > 0) {
		const text = normalizeInsertedText(input);
		const result = insertAt(state.value, state.cursor, text);
		return edit(result.value, result.cursor, {
			start: state.cursor,
			end: state.cursor,
			text,
		});
	}
	return noop(state);
}
