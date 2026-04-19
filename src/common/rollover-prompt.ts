const CURRENT_ROLLOVER_PROMPT =
	"The runtime is auto-finalizing the currently active session because this agent has been idle. Check today's daily memory file one last time and write down anything notable from this session that is still missing. If you changed anything or have anything to report, summarise briefly. Otherwise reply with exactly `ROLLOVER_OK` — no other text.";

export const ROLLOVER_DISPLAY_LABEL = "Rollover";
export const ROLLOVER_NOOP_TEXT = "ROLLOVER_OK";

export function isOperationalRolloverPrompt(content: string): boolean {
	return (
		normalizeWhitespace(content) ===
		normalizeWhitespace(CURRENT_ROLLOVER_PROMPT)
	);
}

export function isRolloverNoopResult(text: string): boolean {
	const normalized = text.trim().replace(/`/g, "").trim();
	return normalized === ROLLOVER_NOOP_TEXT;
}

export { CURRENT_ROLLOVER_PROMPT };

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}
