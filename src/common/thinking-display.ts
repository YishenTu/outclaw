export function formatThinkingForDisplay(content: string): string {
	return content.replace(/^\s*<!--\s*-->\s*$/gm, "").trim();
}
