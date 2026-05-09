import type { DisplayCompactBoundaryMessage } from "./protocol.ts";

export const COMPACT_BOUNDARY_TEXT = "context compacted";

export function createDisplayCompactBoundaryMessage(metadata?: {
	trigger?: string;
	preTokens?: number;
}): DisplayCompactBoundaryMessage {
	return {
		kind: "system",
		event: "compact_boundary",
		text: COMPACT_BOUNDARY_TEXT,
		...(metadata
			? {
					trigger: metadata.trigger === "manual" ? "manual" : "auto",
					preTokens: metadata.preTokens ?? 0,
				}
			: {}),
	};
}

export function formatCompactBoundaryIndicator(
	text = COMPACT_BOUNDARY_TEXT,
): string {
	return `~ ${text} ~`;
}
