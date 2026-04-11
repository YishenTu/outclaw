import chalk, { Chalk, type ChalkInstance } from "chalk";
import { Marked, type MarkedExtension } from "marked";
import { markedTerminal, type TerminalRendererOptions } from "marked-terminal";

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

interface InlineStyles {
	code: (text: string) => string;
	line: (text: string) => string;
	strong: (text: string) => string;
}

interface MarkdownRenderer {
	inlineStyles: InlineStyles;
	marked: Marked;
}

type ColorLevel = 0 | 1 | 2 | 3;

const NORMAL_INLINE_STYLES: InlineStyles = {
	strong: (text) => chalk.bold(text),
	code: (text) => chalk.cyan(text),
	line: (text) => text,
};

const marked = createMarked({
	tab: 2,
	hr: () => HR_PLACEHOLDER,
});

const dimRendererCache = new Map<ColorLevel, MarkdownRenderer>();

function createMarked(options: TerminalRendererOptions): Marked {
	return new Marked(markedTerminal(options) as MarkedExtension);
}

function createDimRenderer(chalkInstance: ChalkInstance): MarkdownRenderer {
	return {
		marked: createMarked({
			tab: 2,
			hr: () => HR_PLACEHOLDER,
			code: chalkInstance.dim.yellow,
			blockquote: chalkInstance.dim.gray.italic,
			html: chalkInstance.dim.gray,
			heading: chalkInstance.dim.green,
			firstHeading: chalkInstance.dim.magenta.underline,
			listitem: chalkInstance.dim,
			table: chalkInstance.dim,
			paragraph: chalkInstance.dim,
			strong: chalkInstance.underline,
			em: chalkInstance.italic,
			codespan: chalkInstance.yellow,
			del: chalkInstance.dim.gray.strikethrough,
			link: chalkInstance.blue,
			href: chalkInstance.blue.underline,
		}),
		inlineStyles: {
			strong: chalkInstance.underline,
			code: chalkInstance.cyan,
			line: chalkInstance.dim,
		},
	};
}

function getDimRenderer(colorLevel: ColorLevel): MarkdownRenderer {
	const existing = dimRendererCache.get(colorLevel);
	if (existing) return existing;
	const renderer = createDimRenderer(new Chalk({ level: colorLevel }));
	dimRendererCache.set(colorLevel, renderer);
	return renderer;
}

/** Apply inline markdown that marked-terminal misses in list items. */
function applyInlineStyles(text: string, styles: InlineStyles): string {
	const withInlineStyles = text
		.replace(/\*\*(.+?)\*\*/g, (_, s) => styles.strong(s))
		.replace(/`(.+?)`/g, (_, s) => styles.code(s));
	return styles.line(withInlineStyles);
}

interface MarkdownRenderOptions {
	dim?: boolean;
	colorLevel?: ColorLevel;
}

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

function isVisualBlank(line: string): boolean {
	return stripAnsi(line).trim().length === 0;
}

function isListLine(line: string): boolean {
	return /^\s*(?:•|\d+\.)\s/.test(stripAnsi(line));
}

function collapseListSpacing(text: string): string {
	const lines = text.split("\n");
	const result: string[] = [];

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] as string;
		if (!isVisualBlank(line)) {
			result.push(line);
			continue;
		}

		const previous = [...result]
			.reverse()
			.find((entry) => !isVisualBlank(entry));
		const next = lines.slice(index + 1).find((entry) => !isVisualBlank(entry));

		if (previous && next && isListLine(previous) && isListLine(next)) {
			continue;
		}

		result.push(line);
	}

	return result.join("\n");
}

export function renderMarkdown(
	text: string,
	width?: number,
	options: MarkdownRenderOptions = {},
): string {
	const sanitized = stripAnsi(text).replace(CTRL_RE, "");
	const renderer = options.dim
		? getDimRenderer(options.colorLevel ?? (chalk.level as ColorLevel))
		: { marked, inlineStyles: NORMAL_INLINE_STYLES };
	const rendered = renderer.marked.parse(sanitized);
	if (typeof rendered !== "string") return text;
	const hrWidth = Math.max(width ?? (process.stdout.columns || 80), 0);
	return collapseListSpacing(
		rendered
			.replace(/\n+$/, "") // strip trailing newlines
			.replace(/^( *)\* /gm, "$1• ") // dot bullets
			.replace(/^( *(?:•|\d+\.) .+)$/gm, (_, line) =>
				applyInlineStyles(line, renderer.inlineStyles),
			) // fix bold/code in list items
			.replaceAll(HR_PLACEHOLDER, "─".repeat(hrWidth)),
	);
}
