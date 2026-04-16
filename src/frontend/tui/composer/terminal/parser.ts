import { Buffer } from "node:buffer";

const kittyModifiers = {
	shift: 1,
	alt: 2,
	ctrl: 4,
	super: 8,
	hyper: 16,
	meta: 32,
	capsLock: 64,
	numLock: 128,
} as const;

const ESCAPE_PATTERN = "\\u001B";

const metaKeyCodeRe = new RegExp(`^(?:${ESCAPE_PATTERN})([a-zA-Z0-9])$`);
const fnKeyRe = new RegExp(
	`^(?:${ESCAPE_PATTERN}+)(O|N|\\[|\\[\\[)(?:(\\d+)(?:;(\\d+))?([~^$])|(?:1;)?(\\d+)?([a-zA-Z]))`,
);

const keyName: Record<string, string> = {
	OP: "f1",
	OQ: "f2",
	OR: "f3",
	OS: "f4",
	"[11~": "f1",
	"[12~": "f2",
	"[13~": "f3",
	"[14~": "f4",
	"[[A": "f1",
	"[[B": "f2",
	"[[C": "f3",
	"[[D": "f4",
	"[[E": "f5",
	"[15~": "f5",
	"[17~": "f6",
	"[18~": "f7",
	"[19~": "f8",
	"[20~": "f9",
	"[21~": "f10",
	"[23~": "f11",
	"[24~": "f12",
	"[A": "up",
	"[B": "down",
	"[C": "right",
	"[D": "left",
	"[E": "clear",
	"[F": "end",
	"[H": "home",
	OA: "up",
	OB: "down",
	OC: "right",
	OD: "left",
	OE: "clear",
	OF: "end",
	OH: "home",
	"[1~": "home",
	"[2~": "insert",
	"[3~": "delete",
	"[4~": "end",
	"[5~": "pageup",
	"[6~": "pagedown",
	"[[5~": "pageup",
	"[[6~": "pagedown",
	"[7~": "home",
	"[8~": "end",
	"[a": "up",
	"[b": "down",
	"[c": "right",
	"[d": "left",
	"[e": "clear",
	"[2$": "insert",
	"[3$": "delete",
	"[5$": "pageup",
	"[6$": "pagedown",
	"[7$": "home",
	"[8$": "end",
	Oa: "up",
	Ob: "down",
	Oc: "right",
	Od: "left",
	Oe: "clear",
	"[2^": "insert",
	"[3^": "delete",
	"[5^": "pageup",
	"[6^": "pagedown",
	"[7^": "home",
	"[8^": "end",
	"[Z": "tab",
};

export const nonAlphanumericKeys = [
	...new Set([...Object.values(keyName), "backspace"]),
];

const kittyKeyRe = new RegExp(
	`^${ESCAPE_PATTERN}\\[(\\d+)(?:;(\\d+)(?::(\\d+))?(?:;([\\d:]+))?)?u$`,
);
const kittySpecialKeyRe = new RegExp(
	`^${ESCAPE_PATTERN}\\[(\\d+);(\\d+):(\\d+)([A-Za-z~])$`,
);

const kittySpecialLetterKeys: Record<string, string> = {
	A: "up",
	B: "down",
	C: "right",
	D: "left",
	E: "clear",
	F: "end",
	H: "home",
	P: "f1",
	Q: "f2",
	R: "f3",
	S: "f4",
};

const kittySpecialNumberKeys: Record<number, string> = {
	2: "insert",
	3: "delete",
	5: "pageup",
	6: "pagedown",
	7: "home",
	8: "end",
	11: "f1",
	12: "f2",
	13: "f3",
	14: "f4",
	15: "f5",
	17: "f6",
	18: "f7",
	19: "f8",
	20: "f9",
	21: "f10",
	23: "f11",
	24: "f12",
};

const kittyCodepointNames: Record<number, string> = {
	27: "escape",
	9: "tab",
	127: "delete",
	8: "backspace",
	57358: "capslock",
	57359: "scrolllock",
	57360: "numlock",
	57361: "printscreen",
	57362: "pause",
	57363: "menu",
};

export interface ParsedTerminalKeypress {
	name: string;
	ctrl: boolean;
	meta: boolean;
	shift: boolean;
	option?: boolean;
	super?: boolean;
	hyper?: boolean;
	capsLock?: boolean;
	numLock?: boolean;
	eventType?: "press" | "repeat" | "release";
	isKittyProtocol?: boolean;
	isPrintable?: boolean;
	text?: string;
	sequence: string;
}

function isShiftKey(code: string): boolean {
	return [
		"[a",
		"[b",
		"[c",
		"[d",
		"[e",
		"[2$",
		"[3$",
		"[5$",
		"[6$",
		"[7$",
		"[8$",
		"[Z",
	].includes(code);
}

function isCtrlKey(code: string): boolean {
	return [
		"Oa",
		"Ob",
		"Oc",
		"Od",
		"Oe",
		"[2^",
		"[3^",
		"[5^",
		"[6^",
		"[7^",
		"[8^",
	].includes(code);
}

function isValidCodepoint(codepoint: number): boolean {
	return (
		codepoint >= 0 &&
		codepoint <= 0x10ffff &&
		!(codepoint >= 0xd800 && codepoint <= 0xdfff)
	);
}

function safeFromCodePoint(codepoint: number): string {
	return isValidCodepoint(codepoint) ? String.fromCodePoint(codepoint) : "?";
}

function resolveEventType(value: number): "press" | "repeat" | "release" {
	if (value === 3) return "release";
	if (value === 2) return "repeat";
	return "press";
}

function parseKittyModifiers(
	modifiers: number,
): Omit<ParsedTerminalKeypress, "name" | "sequence"> {
	return {
		ctrl: Boolean(modifiers & kittyModifiers.ctrl),
		shift: Boolean(modifiers & kittyModifiers.shift),
		meta: Boolean(modifiers & kittyModifiers.meta),
		option: Boolean(modifiers & kittyModifiers.alt),
		super: Boolean(modifiers & kittyModifiers.super),
		hyper: Boolean(modifiers & kittyModifiers.hyper),
		capsLock: Boolean(modifiers & kittyModifiers.capsLock),
		numLock: Boolean(modifiers & kittyModifiers.numLock),
	};
}

function parseKittyKeypress(sequence: string): ParsedTerminalKeypress | null {
	const match = kittyKeyRe.exec(sequence);
	if (!match) {
		return null;
	}

	const codepoint = Number.parseInt(match[1] ?? "", 10);
	const modifiers = match[2]
		? Math.max(0, Number.parseInt(match[2], 10) - 1)
		: 0;
	const eventType = match[3] ? Number.parseInt(match[3], 10) : 1;
	const textField = match[4];

	if (!isValidCodepoint(codepoint)) {
		return null;
	}

	let text: string | undefined;
	if (textField) {
		text = textField
			.split(":")
			.map((value) => safeFromCodePoint(Number.parseInt(value, 10)))
			.join("");
	}

	let name: string;
	let isPrintable: boolean;
	if (codepoint === 32) {
		name = "space";
		isPrintable = true;
	} else if (codepoint === 13) {
		name = "return";
		isPrintable = true;
	} else if (kittyCodepointNames[codepoint]) {
		name = kittyCodepointNames[codepoint] as string;
		isPrintable = false;
	} else if (codepoint >= 1 && codepoint <= 26) {
		name = String.fromCodePoint(codepoint + 96);
		isPrintable = false;
	} else {
		name = safeFromCodePoint(codepoint).toLowerCase();
		isPrintable = true;
	}

	if (isPrintable && !text) {
		text = safeFromCodePoint(codepoint);
	}

	return {
		name,
		...parseKittyModifiers(modifiers),
		eventType: resolveEventType(eventType),
		sequence,
		isKittyProtocol: true,
		isPrintable,
		text,
	};
}

function parseKittySpecialKey(sequence: string): ParsedTerminalKeypress | null {
	const match = kittySpecialKeyRe.exec(sequence);
	if (!match) {
		return null;
	}

	const number = Number.parseInt(match[1] ?? "", 10);
	const modifiers = Math.max(0, Number.parseInt(match[2] ?? "", 10) - 1);
	const eventType = Number.parseInt(match[3] ?? "", 10);
	const terminator = match[4] ?? "";
	const name =
		terminator === "~"
			? kittySpecialNumberKeys[number]
			: kittySpecialLetterKeys[terminator];
	if (!name) {
		return null;
	}

	return {
		name,
		...parseKittyModifiers(modifiers),
		eventType: resolveEventType(eventType),
		sequence,
		isKittyProtocol: true,
		isPrintable: false,
	};
}

export function parseTerminalKeypress(
	value: string | Buffer = "",
): ParsedTerminalKeypress {
	let sequence: string | Buffer = value;
	if (Buffer.isBuffer(sequence)) {
		const firstByte = sequence[0];
		const secondByte = sequence[1];
		if (
			firstByte !== undefined &&
			firstByte > 127 &&
			secondByte === undefined
		) {
			sequence[0] = firstByte - 128;
			sequence = `\x1b${String(sequence)}`;
		} else {
			sequence = String(sequence);
		}
	} else if (sequence !== undefined && typeof sequence !== "string") {
		sequence = String(sequence);
	}

	const source = sequence || "";
	const kittyKeypress = parseKittyKeypress(source);
	if (kittyKeypress) {
		return kittyKeypress;
	}

	const kittySpecialKey = parseKittySpecialKey(source);
	if (kittySpecialKey) {
		return kittySpecialKey;
	}

	if (kittyKeyRe.test(source)) {
		return {
			name: "",
			ctrl: false,
			meta: false,
			shift: false,
			option: false,
			sequence: source,
			isKittyProtocol: true,
			isPrintable: false,
		};
	}

	const keypress: ParsedTerminalKeypress = {
		name: "",
		ctrl: false,
		meta: false,
		shift: false,
		option: false,
		sequence: source,
	};

	if (source === "\r" || source === "\x1b\r") {
		keypress.name = "return";
		keypress.option = source.length === 2;
	} else if (source === "\n") {
		keypress.name = "enter";
	} else if (source === "\t") {
		keypress.name = "tab";
	} else if (source === "\b" || source === "\x1b\b") {
		keypress.name = "backspace";
		keypress.meta = source.startsWith("\x1b");
	} else if (source === "\x7f" || source === "\x1b\x7f") {
		keypress.name = "delete";
		keypress.meta = source.startsWith("\x1b");
	} else if (source === "\x1b" || source === "\x1b\x1b") {
		keypress.name = "escape";
		keypress.meta = source.length === 2;
	} else if (source === " " || source === "\x1b ") {
		keypress.name = "space";
		keypress.meta = source.length === 2;
	} else if (source.length === 1 && source <= "\x1a") {
		keypress.name = String.fromCharCode(
			source.charCodeAt(0) + "a".charCodeAt(0) - 1,
		);
		keypress.ctrl = true;
	} else if (source.length === 1 && source >= "0" && source <= "9") {
		keypress.name = "number";
	} else if (source.length === 1 && source >= "a" && source <= "z") {
		keypress.name = source;
	} else if (source.length === 1 && source >= "A" && source <= "Z") {
		keypress.name = source.toLowerCase();
		keypress.shift = true;
	} else {
		const metaMatch = metaKeyCodeRe.exec(source);
		if (metaMatch) {
			keypress.meta = true;
			keypress.shift = /^[A-Z]$/.test(metaMatch[1] ?? "");
		} else {
			const functionMatch = fnKeyRe.exec(source);
			if (functionMatch) {
				const segments = [...source];
				if (segments[0] === "\x1b" && segments[1] === "\x1b") {
					keypress.option = true;
				}
				const code = [
					functionMatch[1],
					functionMatch[2],
					functionMatch[4],
					functionMatch[6],
				]
					.filter(Boolean)
					.join("");
				const modifier = Number(functionMatch[3] || functionMatch[5] || 1) - 1;
				keypress.ctrl = Boolean(modifier & 4);
				keypress.meta = Boolean(modifier & 10);
				keypress.shift = Boolean(modifier & 1);
				keypress.name = keyName[code] ?? "";
				keypress.shift = isShiftKey(code) || keypress.shift;
				keypress.ctrl = isCtrlKey(code) || keypress.ctrl;
			}
		}
	}

	return keypress;
}

const ESCAPE = "\u001B";

function isCsiParameterByte(byte: number): boolean {
	return byte >= 0x30 && byte <= 0x3f;
}

function isCsiIntermediateByte(byte: number): boolean {
	return byte >= 0x20 && byte <= 0x2f;
}

function isCsiFinalByte(byte: number): boolean {
	return byte >= 0x40 && byte <= 0x7e;
}

function parseCsiSequence(
	input: string,
	startIndex: number,
	prefixLength: number,
): { sequence: string; nextIndex: number } | "pending" | undefined {
	const csiPayloadStart = startIndex + prefixLength + 1;
	let index = csiPayloadStart;
	for (; index < input.length; index++) {
		const byte = input.codePointAt(index);
		if (byte === undefined) {
			return "pending";
		}
		if (isCsiParameterByte(byte) || isCsiIntermediateByte(byte)) {
			continue;
		}
		if (byte === 0x5b && index === csiPayloadStart) {
			continue;
		}
		if (isCsiFinalByte(byte)) {
			return {
				sequence: input.slice(startIndex, index + 1),
				nextIndex: index + 1,
			};
		}
		return undefined;
	}
	return "pending";
}

function parseSs3Sequence(
	input: string,
	startIndex: number,
	prefixLength: number,
): { sequence: string; nextIndex: number } | "pending" | undefined {
	const nextIndex = startIndex + prefixLength + 2;
	if (nextIndex > input.length) {
		return "pending";
	}

	const finalByte = input.codePointAt(nextIndex - 1);
	if (finalByte === undefined || !isCsiFinalByte(finalByte)) {
		return undefined;
	}

	return {
		sequence: input.slice(startIndex, nextIndex),
		nextIndex,
	};
}

function parseControlSequence(
	input: string,
	startIndex: number,
	prefixLength: number,
): { sequence: string; nextIndex: number } | "pending" | undefined {
	const sequenceType = input[startIndex + prefixLength];
	if (sequenceType === undefined) {
		return "pending";
	}
	if (sequenceType === "[") {
		return parseCsiSequence(input, startIndex, prefixLength);
	}
	if (sequenceType === "O") {
		return parseSs3Sequence(input, startIndex, prefixLength);
	}
	return undefined;
}

function parseEscapedCodePoint(
	input: string,
	escapeIndex: number,
): { sequence: string; nextIndex: number } {
	const nextCodePoint = input.codePointAt(escapeIndex + 1);
	const nextCodePointLength =
		nextCodePoint !== undefined && nextCodePoint > 0xffff ? 2 : 1;
	const nextIndex = escapeIndex + 1 + nextCodePointLength;
	return {
		sequence: input.slice(escapeIndex, nextIndex),
		nextIndex,
	};
}

function findNextSpecialIndex(input: string, startIndex: number): number {
	for (let index = startIndex; index < input.length; index += 1) {
		const value = input[index];
		if (value === ESCAPE) {
			return index;
		}
		if (
			value === "\r" &&
			input[index + 1] !== "\n" &&
			(input[index + 1] === undefined || input[index + 1] === ESCAPE)
		) {
			return index;
		}
	}

	return -1;
}

function parseInputChunk(input: string): { events: string[]; pending: string } {
	const events: string[] = [];
	let index = 0;
	const pendingFrom = (pendingStartIndex: number) => ({
		events,
		pending: input.slice(pendingStartIndex),
	});

	while (index < input.length) {
		const specialIndex = findNextSpecialIndex(input, index);
		if (specialIndex === -1) {
			events.push(input.slice(index));
			return { events, pending: "" };
		}
		if (specialIndex > index) {
			events.push(input.slice(index, specialIndex));
		}
		if (input[specialIndex] === "\r") {
			events.push("\r");
			index = specialIndex + 1;
			continue;
		}
		if (specialIndex === input.length - 1) {
			return pendingFrom(specialIndex);
		}

		const parsedSequence = parseControlSequence(input, specialIndex, 1);
		if (parsedSequence === "pending") {
			return pendingFrom(specialIndex);
		}
		if (parsedSequence) {
			events.push(parsedSequence.sequence);
			index = parsedSequence.nextIndex;
			continue;
		}

		const next = input[specialIndex + 1];
		if (next === ESCAPE) {
			if (specialIndex + 2 >= input.length) {
				return pendingFrom(specialIndex);
			}
			const escapedSequence = parseControlSequence(input, specialIndex, 2);
			if (escapedSequence === "pending") {
				return pendingFrom(specialIndex);
			}
			if (escapedSequence) {
				events.push(escapedSequence.sequence);
				index = escapedSequence.nextIndex;
				continue;
			}
			events.push(input.slice(specialIndex, specialIndex + 2));
			index = specialIndex + 2;
			continue;
		}

		const escapedCodePoint = parseEscapedCodePoint(input, specialIndex);
		events.push(escapedCodePoint.sequence);
		index = escapedCodePoint.nextIndex;
	}

	return { events, pending: "" };
}

export interface TerminalInputParser {
	push: (chunk: string | Buffer) => string[];
	hasPendingEscape: () => boolean;
	flushPendingEscape: () => string | undefined;
	reset: () => void;
}

export function createTerminalInputParser(): TerminalInputParser {
	let pending = "";
	return {
		push(chunk) {
			const text = Buffer.isBuffer(chunk) ? String(chunk) : chunk;
			const parsed = parseInputChunk(pending + text);
			pending = parsed.pending;
			return parsed.events;
		},
		hasPendingEscape() {
			return pending.startsWith(ESCAPE);
		},
		flushPendingEscape() {
			if (!pending.startsWith(ESCAPE)) {
				return undefined;
			}
			const pendingEscape = pending;
			pending = "";
			return pendingEscape;
		},
		reset() {
			pending = "";
		},
	};
}
