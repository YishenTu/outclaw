import type { FrontendNotice } from "../../common/protocol.ts";

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
		return undefined;
	} catch {
		return undefined;
	}
}

export function serializeFrontendNotice(notice: FrontendNotice): string {
	return JSON.stringify(notice);
}
