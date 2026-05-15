import { useEffect, useMemo, useState } from "react";
import {
	DEFAULT_EFFORT,
	DEFAULT_MODEL,
	type EffortLevel,
	effortLevelsForModel,
	isEffortLevel,
} from "../../../../common/commands.ts";
import {
	MODEL_ALIAS_LIST,
	type ModelAlias,
	modelAliasForModel,
} from "../../../../common/models.ts";
import type { BrowserChatModel } from "../../../../common/protocol.ts";
import { fetchAgentChatModels } from "../../lib/api.ts";
import {
	formatEffortLabel,
	SelectorDropdown,
} from "./model-selector-controls.tsx";
import { ProviderIcon } from "./provider-icons.tsx";

const EFFORT_MENU_LEVELS: readonly EffortLevel[] = [
	"max",
	"xhigh",
	"high",
	"medium",
	"low",
];

const MODEL_LABELS: Record<ModelAlias, string> = {
	opus: "Opus",
	sonnet: "Sonnet",
	haiku: "Haiku",
};

export interface ChatModelSelection {
	effort?: EffortLevel;
	model: string;
	providerId: string;
	serviceTier?: string;
}

export function resolveCurrentModelAlias(model: string | null): ModelAlias {
	if (!model) {
		return DEFAULT_MODEL as ModelAlias;
	}

	return modelAliasForModel(model) ?? (DEFAULT_MODEL as ModelAlias);
}

export function resolveCurrentEffort(effort: string | null): EffortLevel {
	return effort && isEffortLevel(effort) ? effort : DEFAULT_EFFORT;
}

export function visibleEffortLevelsForModel(
	model: ModelAlias,
): readonly EffortLevel[] {
	return effortLevelsForModel(model, EFFORT_MENU_LEVELS);
}

interface ModelSelectorProps {
	agentId?: string | null;
	providerId?: string | null;
	model: string | null;
	effort: string | null;
	disabled?: boolean;
	sessionActive?: boolean;
	onModelChange: (selection: ChatModelSelection) => boolean;
	onEffortChange: (selection: ChatModelSelection) => boolean;
}

export function ModelSelector({
	agentId = null,
	providerId = null,
	model,
	effort,
	disabled = false,
	sessionActive = false,
	onModelChange,
	onEffortChange,
}: ModelSelectorProps) {
	const [catalog, setCatalog] = useState<BrowserChatModel[]>([]);

	useEffect(() => {
		if (!agentId) {
			setCatalog([]);
			return;
		}

		let cancelled = false;
		void fetchAgentChatModels(agentId)
			.then((response) => {
				if (!cancelled) {
					setCatalog(response.models);
				}
			})
			.catch((error) => {
				if (!cancelled) {
					console.warn("Failed to load chat model catalog", error);
					setCatalog([]);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [agentId]);

	const models = useMemo(
		() =>
			catalog.length > 0
				? catalog
				: fallbackClaudeModels(providerId ?? "claude"),
		[catalog, providerId],
	);
	const currentProviderId = resolveCurrentProviderId({
		model,
		models,
		providerId,
	});
	const currentModel =
		resolveCurrentModel({
			model,
			models,
			providerId: currentProviderId,
		}) ?? models[0];
	const currentEffort = resolveVisibleEffort(effort, currentModel);
	const visibleModels = groupModelsByProvider(
		sessionActive
			? models.filter((candidate) => candidate.providerId === currentProviderId)
			: models,
	);
	const providerCount = new Set(
		visibleModels.map((candidate) => candidate.providerId),
	).size;
	const visibleEffortLevels = effortLevelsForChatModel(currentModel);

	const showGroups = providerCount > 1;

	return (
		<div className="flex items-center gap-1.5">
			<SelectorDropdown
				label={currentModel ? currentModel.displayName : "Model"}
				labelIcon={
					currentModel ? (
						<ProviderIcon providerId={currentModel.providerId} size={12} />
					) : null
				}
				items={visibleModels.map((candidate) => ({
					id: modelKey(candidate),
					label: candidate.displayName,
					icon: <ProviderIcon providerId={candidate.providerId} size={12} />,
					groupLabel: showGroups ? candidate.providerDisplayName : undefined,
				}))}
				selectedId={currentModel ? modelKey(currentModel) : undefined}
				disabled={disabled || visibleModels.length === 0}
				minWidthClassName="min-w-[9rem]"
				onSelect={(item) => {
					const selected = visibleModels.find(
						(candidate) => modelKey(candidate) === item.id,
					);
					if (!selected) {
						return false;
					}
					return onModelChange({
						providerId: selected.providerId,
						model: selected.model,
						effort: compatibleEffortForModel(currentEffort, selected),
					});
				}}
			/>

			<SelectorDropdown
				label={`Thinking: ${formatEffortLabel(currentEffort)}`}
				items={visibleEffortLevels.map((level) => ({
					id: level,
					label: formatEffortLabel(level),
				}))}
				selectedId={currentEffort}
				disabled={disabled || !currentModel || visibleEffortLevels.length === 0}
				minWidthClassName="min-w-[8.5rem]"
				onSelect={(item) => {
					if (!currentModel || !isEffortLevel(item.id)) {
						return false;
					}
					return onEffortChange({
						providerId: currentModel.providerId,
						model: currentModel.model,
						effort: item.id,
					});
				}}
			/>
		</div>
	);
}

function fallbackClaudeModels(providerId: string): BrowserChatModel[] {
	return MODEL_ALIAS_LIST.map((alias) => ({
		providerId,
		providerDisplayName: "Claude",
		model: alias,
		displayName: MODEL_LABELS[alias],
		description: "",
		isDefault: alias === DEFAULT_MODEL,
		defaultReasoningEffort: DEFAULT_EFFORT,
		supportedReasoningEfforts: [...visibleEffortLevelsForModel(alias)],
		serviceTiers: [],
	}));
}

function resolveCurrentProviderId(params: {
	model: string | null;
	models: BrowserChatModel[];
	providerId: string | null;
}): string {
	if (params.providerId) {
		return params.providerId;
	}

	const modelMatch = params.models.find((candidate) =>
		modelMatches(candidate, params.model),
	);
	return (
		modelMatch?.providerId ??
		params.models.find((candidate) => candidate.isDefault)?.providerId ??
		params.models[0]?.providerId ??
		"claude"
	);
}

function resolveCurrentModel(params: {
	model: string | null;
	models: BrowserChatModel[];
	providerId: string;
}): BrowserChatModel | undefined {
	const providerModels = params.models.filter(
		(candidate) => candidate.providerId === params.providerId,
	);
	return (
		providerModels.find((candidate) => modelMatches(candidate, params.model)) ??
		providerModels.find((candidate) => candidate.isDefault) ??
		providerModels[0]
	);
}

function modelMatches(
	candidate: BrowserChatModel,
	model: string | null,
): boolean {
	if (!model) {
		return false;
	}
	return (
		candidate.model === model ||
		modelAliasForModel(candidate.model) === model ||
		modelAliasForModel(model) === candidate.model
	);
}

function resolveVisibleEffort(
	effort: string | null,
	model: BrowserChatModel | undefined,
): EffortLevel {
	if (!model) {
		return resolveCurrentEffort(effort);
	}

	return compatibleEffortForModel(resolveCurrentEffort(effort), model);
}

function compatibleEffortForModel(
	effort: EffortLevel,
	model: BrowserChatModel,
): EffortLevel {
	const levels = effortLevelsForChatModel(model);
	if (levels.includes(effort)) {
		return effort;
	}
	if (isEffortLevel(model.defaultReasoningEffort)) {
		return model.defaultReasoningEffort;
	}
	return levels[0] ?? DEFAULT_EFFORT;
}

function effortLevelsForChatModel(
	model: BrowserChatModel | undefined,
): EffortLevel[] {
	if (!model) {
		return [DEFAULT_EFFORT];
	}

	const providerLevels = model.supportedReasoningEfforts.filter(
		(level): level is EffortLevel => isEffortLevel(level),
	);
	if (providerLevels.length === 0) {
		return [
			...visibleEffortLevelsForModel(resolveCurrentModelAlias(model.model)),
		];
	}

	return EFFORT_MENU_LEVELS.filter((level) => providerLevels.includes(level));
}

function modelKey(model: BrowserChatModel): string {
	return `${model.providerId}:${model.model}`;
}

function groupModelsByProvider(models: BrowserChatModel[]): BrowserChatModel[] {
	const buckets = new Map<string, BrowserChatModel[]>();
	for (const model of models) {
		const bucket = buckets.get(model.providerId);
		if (bucket) {
			bucket.push(model);
		} else {
			buckets.set(model.providerId, [model]);
		}
	}
	return Array.from(buckets.values()).flat();
}

export { formatEffortLabel };
