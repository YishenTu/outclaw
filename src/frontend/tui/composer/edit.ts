export interface EditResult {
	value: string;
	cursor: number;
}

type CharClass = "newline" | "whitespace" | "word" | "punctuation";

interface CursorLocation {
	column: number;
	lineIndex: number;
}

function findLineRange(
	value: string,
	cursor: number,
): { start: number; end: number } {
	const start = value.lastIndexOf("\n", cursor - 1) + 1;
	const end = value.indexOf("\n", cursor);
	return { start, end: end === -1 ? value.length : end };
}

function classifyChar(char: string): CharClass {
	if (char === "\n") return "newline";
	if (/\s/.test(char)) return "whitespace";
	if (/[A-Za-z0-9_]/.test(char)) return "word";
	return "punctuation";
}

function findCursorLocation(value: string, cursor: number): CursorLocation {
	const lines = value.split("\n");
	let position = 0;
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex] as string;
		if (cursor >= position && cursor <= position + line.length) {
			return {
				column: cursor - position,
				lineIndex,
			};
		}
		position += line.length + 1;
	}

	const lastIndex = lines.length - 1;
	return {
		column: (lines[lastIndex] as string | undefined)?.length ?? 0,
		lineIndex: Math.max(lastIndex, 0),
	};
}

export function insertAt(
	value: string,
	cursor: number,
	text: string,
): EditResult {
	return {
		value: value.slice(0, cursor) + text + value.slice(cursor),
		cursor: cursor + text.length,
	};
}

export function deleteBack(value: string, cursor: number): EditResult {
	if (cursor === 0) return { value, cursor };
	return {
		value: value.slice(0, cursor - 1) + value.slice(cursor),
		cursor: cursor - 1,
	};
}

export function deleteForward(value: string, cursor: number): EditResult {
	if (cursor >= value.length) return { value, cursor };
	return {
		value: value.slice(0, cursor) + value.slice(cursor + 1),
		cursor,
	};
}

export function killToLineStart(value: string, cursor: number): EditResult {
	const { start } = findLineRange(value, cursor);
	if (cursor === start) {
		if (cursor === 0) return { value, cursor };
		const previousLineStart = value.lastIndexOf("\n", cursor - 2) + 1;
		return {
			value: value.slice(0, previousLineStart) + value.slice(cursor),
			cursor: previousLineStart,
		};
	}
	return {
		value: value.slice(0, start) + value.slice(cursor),
		cursor: start,
	};
}

export function killToLineEnd(value: string, cursor: number): EditResult {
	const { end } = findLineRange(value, cursor);
	if (cursor === end) return { value, cursor };
	return {
		value: value.slice(0, cursor) + value.slice(end),
		cursor,
	};
}

export function deleteWordBack(value: string, cursor: number): EditResult {
	const i = moveWordBack(value, cursor);
	if (i === cursor) return { value, cursor };
	return {
		value: value.slice(0, i) + value.slice(cursor),
		cursor: i,
	};
}

export function deleteWordForward(value: string, cursor: number): EditResult {
	const end = moveWordForward(value, cursor);
	if (end === cursor) return { value, cursor };
	return {
		value: value.slice(0, cursor) + value.slice(end),
		cursor,
	};
}

export function moveHorizontal(
	value: string,
	cursor: number,
	delta: -1 | 1,
): number {
	return Math.max(0, Math.min(value.length, cursor + delta));
}

export function moveWordBack(value: string, cursor: number): number {
	if (cursor === 0) return 0;
	if (classifyChar(value[cursor - 1] ?? "") === "newline") {
		return cursor - 1;
	}

	let i = cursor;
	while (i > 0 && classifyChar(value[i - 1] ?? "") === "whitespace") {
		i--;
	}
	if (i === 0 || classifyChar(value[i - 1] ?? "") === "newline") {
		return i;
	}

	const targetClass = classifyChar(value[i - 1] ?? "");
	while (i > 0 && classifyChar(value[i - 1] ?? "") === targetClass) {
		i--;
	}
	return i;
}

export function moveWordForward(value: string, cursor: number): number {
	if (cursor >= value.length) return value.length;
	if (classifyChar(value[cursor] ?? "") === "newline") {
		return cursor + 1;
	}

	let i = cursor;
	while (i < value.length && classifyChar(value[i] ?? "") === "whitespace") {
		i++;
	}
	if (i >= value.length || classifyChar(value[i] ?? "") === "newline") {
		return Math.min(value.length, i + 1);
	}

	const targetClass = classifyChar(value[i] ?? "");
	while (i < value.length && classifyChar(value[i] ?? "") === targetClass) {
		i++;
	}
	return i;
}

export function moveVertical(
	value: string,
	cursor: number,
	delta: -1 | 1,
	targetColumn?: number,
): number {
	const lines = value.split("\n");
	const location = findCursorLocation(value, cursor);
	const targetIndex = location.lineIndex + delta;
	if (targetIndex < 0 || targetIndex >= lines.length) return cursor;

	let targetPos = 0;
	for (let i = 0; i < targetIndex; i++) {
		targetPos += (lines[i] as string).length + 1;
	}
	const column = targetColumn ?? location.column;
	return targetPos + Math.min(column, (lines[targetIndex] as string).length);
}

export function getCursorColumn(value: string, cursor: number): number {
	return findCursorLocation(value, cursor).column;
}

export function moveToLineStart(value: string, cursor: number): number {
	return findLineRange(value, cursor).start;
}

export function moveToLineEnd(value: string, cursor: number): number {
	return findLineRange(value, cursor).end;
}
