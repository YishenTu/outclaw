/**
 * Normalize a Codex display name into the canonical `GPT 5.4 Mini` form.
 *
 * Codex itself returns display names in inconsistent shapes (`GPT-5.5`,
 * `gpt-5.4-mini`, `GPT-5.4-Mini`, etc.). The UI wants a single readable form:
 * `GPT` uppercased, numeric version tokens preserved, suffix words title-cased,
 * all space-separated. Non-GPT model names are returned unchanged.
 */
export function formatGptDisplayName(raw: string): string {
	const match = raw.match(/^gpt[-\s]+(.+)$/i);
	const tail = match?.[1];
	if (!tail) {
		return raw;
	}

	const formatted = tail
		.split(/[-\s]+/)
		.filter(Boolean)
		.map((token) =>
			/^[0-9.]+$/.test(token)
				? token
				: token.charAt(0).toUpperCase() + token.slice(1).toLowerCase(),
		)
		.join(" ");

	return `GPT ${formatted}`;
}
