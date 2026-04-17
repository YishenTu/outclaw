import type { UsageInfo } from "./protocol.ts";

export function calculateUsagePercentage(
	contextTokens: number,
	contextWindow: number,
): number {
	return contextWindow > 0
		? Math.min(
				100,
				Math.max(0, Math.round((contextTokens / contextWindow) * 100)),
			)
		: 0;
}

export function recalculateUsageForContextWindow(
	usage: UsageInfo,
	contextWindow: number,
): UsageInfo {
	return {
		...usage,
		contextWindow,
		percentage: calculateUsagePercentage(usage.contextTokens, contextWindow),
	};
}
