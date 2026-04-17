import {
	displayWidth,
	padToDisplayWidth,
	wrapToDisplayWidth,
} from "./display-width.ts";

function wrapParagraph(paragraph: string, contentWidth: number): string[] {
	if (!paragraph) return [""];
	const words = paragraph.split(" ");
	const lines: string[] = [];
	let current = "";
	let currentWidth = 0;

	for (const word of words) {
		for (const chunk of wrapToDisplayWidth(word, contentWidth)) {
			const separator = current ? " " : "";
			const separatorWidth = separator ? 1 : 0;
			const chunkWidth = displayWidth(chunk);
			if (
				current &&
				currentWidth + separatorWidth + chunkWidth > contentWidth
			) {
				lines.push(current);
				current = chunk;
				currentWidth = chunkWidth;
				continue;
			}

			current = `${current}${separator}${chunk}`;
			currentWidth += separatorWidth + chunkWidth;
		}
	}
	if (current) lines.push(current);
	return lines;
}

export function wrapBubble(
	text: string,
	columns: number,
	prefix: string,
): string {
	const prefixWidth = displayWidth(prefix);
	const indent = " ".repeat(prefixWidth);
	const contentWidth = columns - prefixWidth;
	if (contentWidth <= 0) {
		return padToDisplayWidth(`${prefix}${text}`, columns);
	}

	const allLines: string[] = [];
	for (const paragraph of text.split("\n")) {
		allLines.push(...wrapParagraph(paragraph, contentWidth));
	}

	return allLines
		.map((line, index) => {
			const leader = index === 0 ? prefix : indent;
			return padToDisplayWidth(`${leader}${line}`, columns);
		})
		.join("\n");
}
