import type { UsageInfo } from "../../../common/protocol.ts";
import {
	calculateUsagePercentage,
	recalculateUsageForContextWindow,
} from "../../../common/usage.ts";
import { claudeContextWindowForModel } from "./models.ts";

export interface ClaudeModelUsageEntry {
	contextWindow?: number;
	maxOutputTokens?: number;
}

interface ClaudeMessageUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
}

interface ClaudeModelSignature {
	family: "haiku" | "sonnet" | "opus";
	is1M: boolean;
}

export function extractClaudeAssistantUsage(
	event: {
		message?: {
			usage?: ClaudeMessageUsage;
		};
	},
	resolvedModel: string | undefined,
): UsageInfo | undefined {
	const usage = event.message?.usage;
	if (!usage) return undefined;

	const inputTokens = usage.input_tokens ?? 0;
	const outputTokens = usage.output_tokens ?? 0;
	const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
	const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
	const contextTokens = inputTokens + cacheCreationTokens + cacheReadTokens;
	const contextWindow = claudeContextWindowForModel(resolvedModel) ?? 200_000;
	const maxOutputTokens = 32_000;

	return {
		inputTokens,
		outputTokens,
		cacheCreationTokens,
		cacheReadTokens,
		contextWindow,
		maxOutputTokens,
		contextTokens,
		percentage: calculateUsagePercentage(contextTokens, contextWindow),
	};
}

export function applyAuthoritativeClaudeModelUsage(
	usage: UsageInfo | undefined,
	event: {
		modelUsage?: Record<string, ClaudeModelUsageEntry>;
	},
	intendedModel: string | undefined,
): UsageInfo | undefined {
	if (!usage) return undefined;

	const selected = selectModelUsageEntry(event.modelUsage, intendedModel);
	if (!selected) {
		return usage;
	}

	const contextWindow = selected.contextWindow ?? usage.contextWindow;
	const maxOutputTokens = selected.maxOutputTokens ?? usage.maxOutputTokens;

	return {
		...recalculateUsageForContextWindow(usage, contextWindow),
		maxOutputTokens,
	};
}

function selectModelUsageEntry(
	modelUsage: Record<string, ClaudeModelUsageEntry> | undefined,
	intendedModel: string | undefined,
): ClaudeModelUsageEntry | undefined {
	if (!modelUsage) return undefined;

	const entries = Object.entries(modelUsage).flatMap(([model, usage]) =>
		typeof usage?.contextWindow === "number" && usage.contextWindow > 0
			? [{ model, usage }]
			: [],
	);

	if (entries.length === 0) return undefined;
	if (entries.length === 1) return entries[0]?.usage;
	if (!intendedModel) return undefined;

	const exactMatches = entries.filter((entry) => entry.model === intendedModel);
	if (exactMatches.length === 1) {
		return exactMatches[0]?.usage;
	}

	const intendedSignature = getBuiltInModelSignature(intendedModel);
	if (!intendedSignature) return undefined;

	const signatureMatches = entries.filter((entry) => {
		const entrySignature = getModelUsageSignature(entry.model);
		return (
			entrySignature?.family === intendedSignature.family &&
			entrySignature.is1M === intendedSignature.is1M
		);
	});

	return signatureMatches.length === 1 ? signatureMatches[0]?.usage : undefined;
}

function getBuiltInModelSignature(
	model: string,
): ClaudeModelSignature | undefined {
	const normalized = model.trim().toLowerCase();
	if (normalized === "haiku") {
		return { family: "haiku", is1M: false };
	}
	if (normalized === "sonnet" || normalized === "sonnet[1m]") {
		return { family: "sonnet", is1M: normalized.endsWith("[1m]") };
	}
	if (normalized === "opus" || normalized === "opus[1m]") {
		return { family: "opus", is1M: normalized.endsWith("[1m]") };
	}
	if (normalized.includes("haiku")) {
		return { family: "haiku", is1M: false };
	}
	if (normalized.includes("sonnet")) {
		return { family: "sonnet", is1M: normalized.endsWith("[1m]") };
	}
	if (normalized.includes("opus")) {
		return { family: "opus", is1M: normalized.endsWith("[1m]") };
	}
	return undefined;
}

function getModelUsageSignature(
	model: string,
): ClaudeModelSignature | undefined {
	const normalized = model.trim().toLowerCase();
	if (normalized.includes("haiku")) {
		return { family: "haiku", is1M: false };
	}
	if (normalized.includes("sonnet")) {
		return { family: "sonnet", is1M: normalized.endsWith("[1m]") };
	}
	if (normalized.includes("opus")) {
		return { family: "opus", is1M: normalized.endsWith("[1m]") };
	}
	return undefined;
}
