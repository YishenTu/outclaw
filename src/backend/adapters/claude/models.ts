import {
	DEFAULT_EFFORT,
	EFFORT_LEVELS,
	type EffortLevel,
} from "../../../common/commands.ts";
import type { ProviderModelInfo } from "../../../common/protocol.ts";

export const CLAUDE_MODELS = {
	opus: { id: "claude-opus-4-7[1m]", contextWindow: 1_000_000 },
	sonnet: { id: "sonnet", contextWindow: 200_000 },
	haiku: { id: "haiku", contextWindow: 200_000 },
} as const;

export type ClaudeModelAlias = keyof typeof CLAUDE_MODELS;

export const DEFAULT_CLAUDE_MODEL: ClaudeModelAlias = "opus";

export const CLAUDE_MODEL_ALIASES = Object.keys(
	CLAUDE_MODELS,
) as ClaudeModelAlias[];

const OPUS_ONLY_EFFORT_LEVELS = new Set<EffortLevel>(["xhigh"]);

const CLAUDE_MODEL_DISPLAY_NAMES: Record<ClaudeModelAlias, string> = {
	opus: "Claude Opus 4.7 (1M)",
	sonnet: "Claude Sonnet",
	haiku: "Claude Haiku",
};

const CLAUDE_MODEL_DESCRIPTIONS: Record<ClaudeModelAlias, string> = {
	opus: "Most capable Claude model.",
	sonnet: "Balanced Claude model.",
	haiku: "Fast Claude model.",
};

export function isClaudeModelAlias(value: string): value is ClaudeModelAlias {
	return Object.hasOwn(CLAUDE_MODELS, value);
}

export function resolveClaudeModelForSdk(
	model: string | undefined,
): string | undefined {
	if (!model) {
		return model;
	}
	return isClaudeModelAlias(model) ? CLAUDE_MODELS[model].id : model;
}

export function claudeContextWindowForModel(
	model: string | undefined,
): number | undefined {
	if (!model) {
		return undefined;
	}
	if (isClaudeModelAlias(model)) {
		return CLAUDE_MODELS[model].contextWindow;
	}
	for (const alias of CLAUDE_MODEL_ALIASES) {
		if (CLAUDE_MODELS[alias].id === model) {
			return CLAUDE_MODELS[alias].contextWindow;
		}
	}
	return undefined;
}

export function claudeEffortLevelsForModel(
	model: string,
	levels: readonly EffortLevel[] = EFFORT_LEVELS,
): EffortLevel[] {
	return levels.filter((effort) =>
		isClaudeEffortAllowedForModel(effort, model),
	);
}

export function describeClaudeModel(
	alias: ClaudeModelAlias,
): ProviderModelInfo {
	const supportedEfforts = claudeEffortLevelsForModel(alias);
	const defaultEffort = supportedEfforts.includes(DEFAULT_EFFORT)
		? DEFAULT_EFFORT
		: (supportedEfforts[0] ?? DEFAULT_EFFORT);
	return {
		id: CLAUDE_MODELS[alias].id,
		model: alias,
		displayName: CLAUDE_MODEL_DISPLAY_NAMES[alias] ?? alias,
		description: CLAUDE_MODEL_DESCRIPTIONS[alias] ?? "",
		isDefault: alias === DEFAULT_CLAUDE_MODEL,
		defaultReasoningEffort: defaultEffort,
		supportedReasoningEfforts: [...supportedEfforts],
		serviceTiers: [],
		contextWindow: CLAUDE_MODELS[alias].contextWindow,
	};
}

function isClaudeEffortAllowedForModel(
	effort: EffortLevel,
	model: string,
): boolean {
	return !OPUS_ONLY_EFFORT_LEVELS.has(effort) || isClaudeOpusModel(model);
}

function isClaudeOpusModel(model: string): boolean {
	return resolveClaudeModelForSdk(model) === CLAUDE_MODELS.opus.id;
}
