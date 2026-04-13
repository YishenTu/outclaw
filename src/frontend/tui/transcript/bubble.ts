function wrapParagraph(paragraph: string, contentWidth: number): string[] {
	if (!paragraph) return [""];
	const words = paragraph.split(" ");
	const lines: string[] = [];
	let current = "";

	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (next.length > contentWidth && current) {
			lines.push(current);
			current = word;
		} else {
			current = next;
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
	const indent = " ".repeat(prefix.length);
	const contentWidth = columns - prefix.length;
	if (contentWidth <= 0) return `${prefix}${text}`.padEnd(columns);

	const allLines: string[] = [];
	for (const paragraph of text.split("\n")) {
		allLines.push(...wrapParagraph(paragraph, contentWidth));
	}

	return allLines
		.map((line, index) => {
			const leader = index === 0 ? prefix : indent;
			return `${leader}${line}`.padEnd(columns);
		})
		.join("\n");
}
