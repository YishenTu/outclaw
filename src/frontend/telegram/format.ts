import { Marked } from "marked";

function escapeHtml(text: string): string {
	return text
		.replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[\da-fA-F]+);)/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escapeHtmlAttr(text: string): string {
	return escapeHtml(text).replace(/"/g, "&quot;");
}

let listDepth = 0;

const marked = new Marked({
	renderer: {
		heading({ tokens, depth: _depth }) {
			return `<b>${this.parser.parseInline(tokens)}</b>\n\n`;
		},
		paragraph({ tokens }) {
			return `${this.parser.parseInline(tokens)}\n\n`;
		},
		strong({ tokens }) {
			return `<b>${this.parser.parseInline(tokens)}</b>`;
		},
		em({ tokens }) {
			return `<i>${this.parser.parseInline(tokens)}</i>`;
		},
		del({ tokens }) {
			return `<s>${this.parser.parseInline(tokens)}</s>`;
		},
		codespan({ text }) {
			return `<code>${escapeHtml(text)}</code>`;
		},
		code({ text, lang }) {
			const langAttr = lang ? ` class="language-${escapeHtmlAttr(lang)}"` : "";
			return `<pre><code${langAttr}>${escapeHtml(text)}</code></pre>\n\n`;
		},
		link({ href, tokens }) {
			return `<a href="${escapeHtmlAttr(href)}">${this.parser.parseInline(tokens)}</a>`;
		},
		blockquote({ tokens }) {
			const body = this.parser.parse(tokens).replace(/\n+$/, "");
			return `<blockquote>${body}</blockquote>\n\n`;
		},
		listitem(item) {
			let prefix = "";
			if (item.task) {
				prefix = item.checked ? "\u2611 " : "\u2610 ";
			}
			const body = this.parser
				.parse(item.tokens, !!item.loose)
				.replace(/\n+$/, "");
			return `${prefix}${body}`;
		},
		list({ items, ordered, start }) {
			const indent = "  ".repeat(listDepth);
			const startNum = Number(start) || 1;
			listDepth++;
			try {
				const rendered = items
					.map((item, index) => {
						const prefix = ordered ? `${startNum + index}. ` : "\u2022 ";
						return `${indent}${prefix}${this.listitem(item)}`;
					})
					.join("\n");
				const separator = listDepth > 1 ? "\n" : "";
				return `${separator}${rendered}\n\n`;
			} finally {
				listDepth--;
			}
		},
		table({ header, rows }) {
			const headerCells = header.map((cell) =>
				this.parser.parseInline(cell.tokens),
			);
			const bodyRows = rows.map((row) =>
				row.map((cell) => this.parser.parseInline(cell.tokens)),
			);
			const lines: string[] = [];
			for (const row of bodyRows) {
				const parts: string[] = [];
				for (let i = 0; i < row.length; i++) {
					const label = headerCells[i];
					const value = row[i];
					if (label && value) {
						parts.push(`<b>${label}</b>: ${value}`);
					} else if (value) {
						parts.push(value);
					}
				}
				lines.push(parts.join(" | "));
			}
			return `${lines.join("\n")}\n\n`;
		},
		tablerow() {
			return "";
		},
		tablecell() {
			return "";
		},
		hr() {
			return "\u2500\u2500\u2500\n\n";
		},
		br() {
			return "\n";
		},
		image({ href, title, text: altText }) {
			return escapeHtml(altText || title || href);
		},
		html({ text }) {
			return escapeHtml(text);
		},
		text(token) {
			if ("tokens" in token && token.tokens) {
				return this.parser.parseInline(token.tokens);
			}
			return escapeHtml(token.text);
		},
	},
});

export const TELEGRAM_MESSAGE_LIMIT = 4096;

// Matches HTML open/close tags, capturing: [0]=full match, [1]="<" or "</", [2]=tagName
const TAG_RE = /(<\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;

type OpenTag = { name: string; full: string };

/**
 * Find a safe split position that does not break HTML tags or entities.
 * Returns an index in (0, limit] that is outside any `<…>` or `&…;`.
 * Falls back to `limit` for hard-split when no safe point exists.
 */
function findSafeSplitPosition(html: string, limit: number): number {
	let pos = limit;

	const lastAmp = html.lastIndexOf("&", pos - 1);
	if (lastAmp >= 0) {
		const semiAfter = html.indexOf(";", lastAmp);
		if (semiAfter >= pos) pos = lastAmp;
	}

	const lastOpen = html.lastIndexOf("<", pos - 1);
	if (lastOpen >= 0) {
		const closeAfter = html.indexOf(">", lastOpen);
		if (closeAfter >= pos) pos = lastOpen;
	}

	// Guarantee forward progress: never return 0.
	return pos > 0 ? pos : limit;
}

/**
 * Collect open tags (with their full opening-tag text) from an HTML fragment.
 */
function collectOpenTags(html: string): OpenTag[] {
	const stack: OpenTag[] = [];
	TAG_RE.lastIndex = 0;
	let match = TAG_RE.exec(html);
	while (match !== null) {
		const isClosing = match[1] === "</";
		const tagName = (match[2] as string).toLowerCase();
		if (isClosing) {
			for (let i = stack.length - 1; i >= 0; i--) {
				if (stack[i]?.name === tagName) {
					stack.splice(i, 1);
					break;
				}
			}
		} else {
			stack.push({ name: tagName, full: match[0] });
		}
		match = TAG_RE.exec(html);
	}
	return stack;
}

function buildCloseString(tags: OpenTag[]): string {
	return tags
		.slice()
		.reverse()
		.map((t) => `</${t.name}>`)
		.join("");
}

function buildOpenString(tags: OpenTag[]): string {
	return tags.map((t) => t.full).join("");
}

export function splitTelegramHtml(html: string, limit: number): string[] {
	if (!html) return [];
	if (html.length <= limit) return [html];

	const chunks: string[] = [];
	let remaining = html;
	let carryTags: OpenTag[] = [];

	while (remaining.length > 0) {
		const prefix = buildOpenString(carryTags);
		const suffixReserve = buildCloseString(carryTags).length;
		const available = limit - prefix.length - suffixReserve;

		if (available <= 0) {
			chunks.push(remaining.slice(0, limit));
			remaining = remaining.slice(limit);
			carryTags = [];
			continue;
		}

		if (remaining.length <= available) {
			const openTags = collectOpenTags(`${prefix}${remaining}`);
			chunks.push(`${prefix}${remaining}${buildCloseString(openTags)}`);
			break;
		}

		let splitAt = findSafeSplitPosition(remaining, available);

		const slice = remaining.slice(0, splitAt);
		const paraBound = slice.lastIndexOf("\n\n");
		if (paraBound > 0) {
			splitAt = paraBound;
		} else {
			const lineBound = slice.lastIndexOf("\n");
			if (lineBound > 0) {
				splitAt = lineBound;
			}
		}

		let chunk = remaining.slice(0, splitAt);
		let openTags = collectOpenTags(`${prefix}${chunk}`);
		let suffix = buildCloseString(openTags);
		let fullChunk = `${prefix}${chunk}${suffix}`;

		// If suffix overhead pushes past the limit, shrink the content.
		if (fullChunk.length > limit && splitAt > 1) {
			const overshoot = fullChunk.length - limit;
			splitAt = findSafeSplitPosition(
				remaining,
				Math.max(1, splitAt - overshoot),
			);
			chunk = remaining.slice(0, splitAt);
			openTags = collectOpenTags(`${prefix}${chunk}`);
			suffix = buildCloseString(openTags);
			fullChunk = `${prefix}${chunk}${suffix}`;
		}
		chunks.push(fullChunk);

		let advance = splitAt;
		while (advance < remaining.length && remaining[advance] === "\n") {
			advance++;
		}
		remaining = remaining.slice(advance);
		carryTags = openTags;
	}

	return chunks;
}

export function markdownToTelegramHtml(markdown: string): string {
	if (!markdown) return "";
	const html = marked.parse(markdown);
	if (typeof html !== "string") return "";
	return html.replace(/\n+$/, "");
}
