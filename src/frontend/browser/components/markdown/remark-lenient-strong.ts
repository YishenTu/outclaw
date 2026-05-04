import type { PhrasingContent, Root, Text } from "mdast";
import type { Plugin } from "unified";
import { SKIP, visit } from "unist-util-visit";

const LENIENT_STRONG_RE = /\*\*(\S(?:[^*\n]*?\S)?)\*\*/g;

/**
 * Rescue `**bold**` runs that CommonMark's left/right-flanking rules reject
 * when they sit between an alphanumeric and a punctuation character — e.g.
 * `word**"x"**`, `**"x"**word`, `1. **"x"**word`. The default parser leaves
 * these as literal `**` in text nodes; this plugin walks remaining text nodes
 * and converts the surviving runs into `strong` AST nodes. Underscore (`__`)
 * intra-word emphasis is intentionally untouched so identifiers like
 * `snake_case` keep rendering as text.
 */
export const remarkLenientStrong: Plugin<[], Root> = () => (tree) => {
	visit(tree, "text", (node, index, parent) => {
		if (!parent || index === undefined) return;
		const value = (node as Text).value;
		if (!value.includes("**")) return;

		LENIENT_STRONG_RE.lastIndex = 0;
		const replacements: PhrasingContent[] = [];
		let cursor = 0;
		let match: RegExpExecArray | null = LENIENT_STRONG_RE.exec(value);
		while (match !== null) {
			const before = value.slice(cursor, match.index);
			if (before) replacements.push({ type: "text", value: before });
			replacements.push({
				type: "strong",
				children: [{ type: "text", value: match[1] ?? "" }],
			});
			cursor = match.index + match[0].length;
			match = LENIENT_STRONG_RE.exec(value);
		}
		if (cursor === 0) return;
		const tail = value.slice(cursor);
		if (tail) replacements.push({ type: "text", value: tail });

		parent.children.splice(index, 1, ...replacements);
		return [SKIP, index + replacements.length];
	});
};
