export const SESSION_SEARCH_QUERY_MAX_LENGTH = 256;

export function sessionSearchQueryTooLongMessage(): string {
	return `Session search query must be ${SESSION_SEARCH_QUERY_MAX_LENGTH} characters or fewer`;
}

export function validateSessionSearchQuery(
	query: string,
): { ok: true; query: string } | { message: string; ok: false } {
	const trimmed = query.trim();
	if (trimmed.length > SESSION_SEARCH_QUERY_MAX_LENGTH) {
		return { ok: false, message: sessionSearchQueryTooLongMessage() };
	}
	return { ok: true, query: trimmed };
}
