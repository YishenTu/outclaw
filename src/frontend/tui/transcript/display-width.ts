const graphemeSegmenter =
	typeof Intl !== "undefined" && "Segmenter" in Intl
		? new Intl.Segmenter(undefined, { granularity: "grapheme" })
		: undefined;

function splitGraphemes(text: string): string[] {
	if (!graphemeSegmenter) {
		return Array.from(text);
	}

	return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
}

function isZeroWidthCodePoint(codePoint: number): boolean {
	return (
		codePoint === 0x200d ||
		(codePoint >= 0x0300 && codePoint <= 0x036f) ||
		(codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
		(codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
		(codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
		(codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
		(codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
		(codePoint >= 0xe0100 && codePoint <= 0xe01ef)
	);
}

function isWideCodePoint(codePoint: number): boolean {
	return (
		codePoint >= 0x1100 &&
		(codePoint <= 0x115f ||
			codePoint === 0x2329 ||
			codePoint === 0x232a ||
			(codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
			(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
			(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
			(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
			(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
			(codePoint >= 0xff00 && codePoint <= 0xff60) ||
			(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
			(codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff) ||
			(codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
			(codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
			(codePoint >= 0x20000 && codePoint <= 0x3fffd))
	);
}

function segmentDisplayWidth(segment: string): number {
	const codePoints = Array.from(segment, (value) => value.codePointAt(0) ?? 0);
	let width = 0;
	let hasWideCodePoint = false;

	for (const codePoint of codePoints) {
		if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
			continue;
		}
		if (isZeroWidthCodePoint(codePoint)) {
			continue;
		}
		if (isWideCodePoint(codePoint)) {
			hasWideCodePoint = true;
			width += 2;
			continue;
		}
		width += 1;
	}

	if (codePoints.length > 1 && hasWideCodePoint) {
		return 2;
	}

	return Math.max(width, 0);
}

export function displayWidth(text: string): number {
	return splitGraphemes(text).reduce((total, segment) => {
		return total + segmentDisplayWidth(segment);
	}, 0);
}

export function padToDisplayWidth(text: string, width: number): string {
	const remainder = width - displayWidth(text);
	return remainder > 0 ? `${text}${" ".repeat(remainder)}` : text;
}

export function wrapToDisplayWidth(text: string, width: number): string[] {
	if (text === "") {
		return [""];
	}

	const lines: string[] = [];
	let current = "";
	let currentWidth = 0;

	for (const segment of splitGraphemes(text)) {
		const segmentWidth = segmentDisplayWidth(segment);
		if (current !== "" && currentWidth + segmentWidth > width) {
			lines.push(current);
			current = segment;
			currentWidth = segmentWidth;
			continue;
		}

		current += segment;
		currentWidth += segmentWidth;
	}

	if (current !== "") {
		lines.push(current);
	}

	return lines;
}
