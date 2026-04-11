import chalk from "chalk";
import { Marked, type MarkedExtension } from "marked";
import { markedTerminal } from "marked-terminal";

const HR_PLACEHOLDER = "\x00HR\x00";

const marked = new Marked(
	markedTerminal({
		tab: 2,
		hr: () => HR_PLACEHOLDER,
	}) as MarkedExtension,
);

/** Apply inline markdown that marked-terminal misses in list items. */
function applyInlineStyles(text: string): string {
	return text
		.replace(/\*\*(.+?)\*\*/g, (_, s) => chalk.bold(s))
		.replace(/`(.+?)`/g, (_, s) => chalk.cyan(s));
}

export function renderMarkdown(text: string, width?: number): string {
	const rendered = marked.parse(text);
	if (typeof rendered !== "string") return text;
	const hrWidth = Math.max(width ?? (process.stdout.columns || 80), 0);
	return rendered
		.replace(/\n+$/, "") // strip trailing newlines
		.replace(/^( *)\* /gm, "$1• ") // dot bullets
		.replace(/^( *(?:•|\d+\.) .+)$/gm, (_, line) => applyInlineStyles(line)) // fix bold/code in list items
		.replaceAll(HR_PLACEHOLDER, "─".repeat(hrWidth));
}
