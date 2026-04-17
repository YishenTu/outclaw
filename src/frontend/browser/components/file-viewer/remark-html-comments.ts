const HTML_COMMENT_PATTERN = /^\s*<!--([\s\S]*?)-->\s*$/;

interface MdNode {
	type: string;
	value?: string;
	children?: MdNode[];
	data?: {
		hName?: string;
		hProperties?: Record<string, unknown>;
	};
}

export function remarkHtmlComments() {
	return (tree: MdNode) => {
		transformBlockChildren(tree);
	};
}

function transformBlockChildren(node: MdNode): void {
	if (!node.children) {
		return;
	}
	const next: MdNode[] = [];
	for (const child of node.children) {
		const replaced = tryReplaceHtmlComment(child);
		if (replaced) {
			next.push(replaced);
			continue;
		}
		if (isBlockContainer(child.type)) {
			transformBlockChildren(child);
		}
		next.push(child);
	}
	node.children = next;
}

function tryReplaceHtmlComment(node: MdNode): MdNode | null {
	if (node.type !== "html" || typeof node.value !== "string") {
		return null;
	}
	const match = node.value.match(HTML_COMMENT_PATTERN);
	const inner = match?.[1];
	if (inner === undefined) {
		return null;
	}
	return {
		type: "paragraph",
		data: {
			hName: "div",
			hProperties: { className: "md-comment" },
		},
		children: [{ type: "text", value: inner.trim() }],
	};
}

function isBlockContainer(type: string): boolean {
	return type === "blockquote" || type === "list" || type === "listItem";
}
