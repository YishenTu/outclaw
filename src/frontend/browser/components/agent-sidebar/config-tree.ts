import type { ConfigEntry } from "./config-editor.ts";

export interface ConfigTreeNode {
	children: ConfigTreeNode[];
	entry?: ConfigEntry;
	key: string;
	label: string;
}

export function buildConfigEntryTree(entries: ConfigEntry[]): ConfigTreeNode[] {
	const roots: ConfigTreeNode[] = [];

	for (const entry of entries) {
		const path = entry.displayItem ?? entry.item;
		const tokens = tokenizeDisplayPath(path);
		if (tokens.length === 0) {
			continue;
		}

		let currentNodes = roots;
		let currentNode: ConfigTreeNode | undefined;
		for (const token of tokens) {
			const existing = currentNodes.find((node) => node.key === token);
			currentNode =
				existing ??
				(() => {
					const created: ConfigTreeNode = {
						children: [],
						key: token,
						label: token,
					};
					currentNodes.push(created);
					return created;
				})();
			currentNodes = currentNode.children;
		}

		if (currentNode) {
			currentNode.entry = entry;
		}
	}

	return roots;
}

function tokenizeDisplayPath(path: string): string[] {
	if (path === "$") {
		return ["$"];
	}

	const tokens: string[] = [];
	let current = "";
	for (let index = 0; index < path.length; index += 1) {
		const character = path[index];
		if (character === ".") {
			pushToken(tokens, current);
			current = "";
			continue;
		}
		if (character === "[") {
			pushToken(tokens, current);
			current = "";
			const endIndex = path.indexOf("]", index);
			if (endIndex === -1) {
				throw new Error(`Invalid config display path: ${path}`);
			}
			tokens.push(path.slice(index, endIndex + 1));
			index = endIndex;
			continue;
		}
		current += character;
	}

	pushToken(tokens, current);
	return tokens;
}

function pushToken(tokens: string[], value: string) {
	if (value !== "") {
		tokens.push(value);
	}
}
