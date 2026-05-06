import type { FrontendNotice, RolloverNotice } from "../../common/protocol.ts";

export function parseFrontendNotice(
	value: string | undefined,
): FrontendNotice | undefined {
	if (!value) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(value) as Partial<FrontendNotice>;
		if (parsed.kind === "restart_required") {
			return { kind: "restart_required" };
		}
		if (parsed.kind === "rollover" && typeof parsed.message === "string") {
			return {
				kind: "rollover",
				message: parsed.message,
				...(parsed.finalCheck === "failed" ? { finalCheck: "failed" } : {}),
			};
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export function parseRolloverNotice(
	value: string | undefined,
): RolloverNotice | undefined {
	const parsed = parseFrontendNotice(value);
	if (parsed?.kind === "rollover") {
		return parsed;
	}
	if (!value) {
		return undefined;
	}
	if (value.trimStart().startsWith("{")) {
		return undefined;
	}

	return {
		kind: "rollover",
		message: value,
		...(value.includes("Final check failed")
			? { finalCheck: "failed" as const }
			: {}),
	};
}

export function serializeFrontendNotice(notice: FrontendNotice): string {
	return JSON.stringify(notice);
}
