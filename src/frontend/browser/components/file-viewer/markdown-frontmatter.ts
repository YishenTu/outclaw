export interface MarkdownFrontmatterParts {
	frontmatter: string;
	body: string;
}

const FRONTMATTER_PATTERN =
	/^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/;

export function splitMarkdownFrontmatter(
	content: string,
): MarkdownFrontmatterParts | null {
	const match = FRONTMATTER_PATTERN.exec(content);
	if (!match) {
		return null;
	}

	const frontmatter = match[1];
	if (frontmatter === undefined) {
		return null;
	}

	return {
		frontmatter,
		body: content.slice(match[0].length),
	};
}
