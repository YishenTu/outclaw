export type LastUserTarget =
	| { kind: "tui" }
	| { kind: "telegram"; chatId: number };

export function parseLastUserTarget(
	value: string | undefined,
): LastUserTarget | undefined {
	if (!value) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(value) as Partial<LastUserTarget>;
		if (parsed.kind === "tui") {
			return { kind: "tui" };
		}
		if (
			parsed.kind === "telegram" &&
			typeof parsed.chatId === "number" &&
			Number.isFinite(parsed.chatId)
		) {
			return {
				kind: "telegram",
				chatId: parsed.chatId,
			};
		}
	} catch {
		return undefined;
	}

	return undefined;
}

export function serializeLastUserTarget(target: LastUserTarget): string {
	return JSON.stringify(target);
}
