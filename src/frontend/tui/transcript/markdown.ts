import chalk from "chalk";
import { Marked, type MarkedExtension } from "marked";
import { markedTerminal } from "marked-terminal";

const HR_PLACEHOLDER = "\x00HR\x00";

const ESC = "\x1b";
const BEL = "\x07";
/** ANSI CSI sequences, OSC sequences, other two-char escapes. */
const ANSI_RE = new RegExp(
	`${ESC}\\[[0-9;]*[A-Za-z]|${ESC}\\][^${BEL}]*${BEL}|${ESC}[^\\[\\]]`,
	"g",
);
/** C0 control chars except \t (09), \n (0A), \r (0D). Also strips DEL (7F). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matches control chars
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

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
	const sanitized = text.replace(ANSI_RE, "").replace(CTRL_RE, "");
	const rendered = marked.parse(sanitized);
	if (typeof rendered !== "string") return text;
	const hrWidth = Math.max(width ?? (process.stdout.columns || 80), 0);
	return rendered
		.replace(/\n+$/, "") // strip trailing newlines
		.replace(/^( *)\* /gm, "$1• ") // dot bullets
		.replace(/^( *(?:•|\d+\.) .+)$/gm, (_, line) => applyInlineStyles(line)) // fix bold/code in list items
		.replaceAll(HR_PLACEHOLDER, "─".repeat(hrWidth));
}
