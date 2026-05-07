export function normalizeTitleSearchTokens(query: string): string[] {
	return normalizeTitleSearchText(query)
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token !== "");
}

export function titleMatchesSearchTokens(
	title: string,
	tokens: readonly string[],
): boolean {
	const normalizedTitle = normalizeTitleSearchText(title);
	return tokens.every((token) => normalizedTitle.includes(token));
}

function normalizeTitleSearchText(value: string): string {
	return value.normalize("NFC").toLocaleLowerCase().normalize("NFC").trim();
}
