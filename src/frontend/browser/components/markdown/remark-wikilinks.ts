import type { PhrasingContent, Root, Text } from "mdast";
import type { Plugin } from "unified";
import { SKIP, visit } from "unist-util-visit";

const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g;
const WIKILINK_CLASS_NAME = "md-wikilink text-brand font-bold";

export const remarkWikilinks: Plugin<[], Root> = () => (tree) => {
	visit(tree, "text", (node, index, parent) => {
		if (!parent || index === undefined) return;

		const value = (node as Text).value;
		if (!value.includes("[[")) return;

		WIKILINK_RE.lastIndex = 0;
		const replacements: PhrasingContent[] = [];
		let cursor = 0;
		let match: RegExpExecArray | null = WIKILINK_RE.exec(value);

		while (match !== null) {
			const before = value.slice(cursor, match.index);
			if (before) replacements.push({ type: "text", value: before });
			replacements.push({
				type: "strong",
				data: {
					hProperties: {
						className: WIKILINK_CLASS_NAME,
					},
				},
				children: [{ type: "text", value: match[1] ?? "" }],
			});
			cursor = match.index + match[0].length;
			match = WIKILINK_RE.exec(value);
		}

		if (cursor === 0) return;
		const tail = value.slice(cursor);
		if (tail) replacements.push({ type: "text", value: tail });

		parent.children.splice(index, 1, ...replacements);
		return [SKIP, index + replacements.length];
	});
};
