import { Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	DEFAULT_EFFORT,
	type EffortLevel,
	isEffortLevel,
} from "../../../../common/commands.ts";
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

export interface ChatModelSelection {
	contextWindow?: number;
	effort?: EffortLevel;
	model: string;
	providerId: string;
	serviceTier?: string;
}

export function resolveCurrentEffort(effort: string | null): EffortLevel {
	return effort && isEffortLevel(effort) ? effort : DEFAULT_EFFORT;
}

interface ModelSelectorProps {
	agentId?: string | null;
	providerId?: string | null;
	model: string | null;
	effort: string | null;
	serviceTier?: string | null;
	disabled?: boolean;
	sessionActive?: boolean;
	showEffortLabelPrefix?: boolean;
	onModelChange: (selection: ChatModelSelection) => boolean;
	onEffortChange: (selection: ChatModelSelection) => boolean;
}

export function ModelSelector({
	agentId = null,
	providerId = null,
	model,
	effort,
	serviceTier = null,
	disabled = false,
	sessionActive = false,
	showEffortLabelPrefix = true,
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

	const models = useMemo(() => catalog, [catalog]);
	const currentSelection = resolveModelSelectorCurrentModel({
		model,
		models,
		providerId,
	});
	const currentProviderId = currentSelection.providerId;
	const currentModel = currentSelection.model;
	const currentModelSelectable = currentSelection.selectable;
	const currentEffort = currentModelSelectable
		? resolveVisibleEffort(effort, currentModel)
		: resolveCurrentEffort(effort);
	const visibleModels = groupModelsByProvider(
		sessionActive
			? models.filter((candidate) => candidate.providerId === currentProviderId)
			: models,
	);
	const providerCount = new Set(
		visibleModels.map((candidate) => candidate.providerId),
	).size;
	const visibleEffortLevels = currentModelSelectable
		? effortLevelsForChatModel(currentModel)
		: [];
	const fastTier = resolveFastServiceTier(currentModel);
	const fastTierEnabled = serviceTier === fastTier?.id;
	const fastTierLabel = fastTier?.name ?? "Fast";
	const fastTierTooltip = fastTier?.description ?? "";
	const effortLabel = formatEffortLabel(currentEffort);

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
				disabled={
					disabled || !currentModelSelectable || visibleModels.length === 0
				}
				minWidthClassName="min-w-[9rem]"
				onSelect={(item) => {
					const selected = visibleModels.find(
						(candidate) => modelKey(candidate) === item.id,
					);
					if (!selected) {
						return false;
					}
					const selectedFastTier = resolveFastServiceTier(selected);
					return onModelChange({
						providerId: selected.providerId,
						model: selected.model,
						effort: compatibleEffortForChatModel(currentEffort, selected),
						...(serviceTier && serviceTier === selectedFastTier?.id
							? { serviceTier }
							: {}),
						...(selected.contextWindow !== undefined
							? { contextWindow: selected.contextWindow }
							: {}),
					});
				}}
			/>

			<SelectorDropdown
				label={showEffortLabelPrefix ? `Thinking: ${effortLabel}` : effortLabel}
				items={visibleEffortLevels.map((level) => ({
					id: level,
					label: formatEffortLabel(level),
				}))}
				selectedId={currentEffort}
				disabled={
					disabled ||
					!currentModel ||
					!currentModelSelectable ||
					visibleEffortLevels.length === 0
				}
				minWidthClassName="min-w-[8.5rem]"
				onSelect={(item) => {
					if (!currentModel || !isEffortLevel(item.id)) {
						return false;
					}
					return onEffortChange({
						providerId: currentModel.providerId,
						model: currentModel.model,
						effort: item.id,
						...(serviceTier && serviceTier === fastTier?.id
							? { serviceTier }
							: {}),
						...(currentModel.contextWindow !== undefined
							? { contextWindow: currentModel.contextWindow }
							: {}),
					});
				}}
			/>

			{fastTier && currentModel && (
				<button
					type="button"
					disabled={disabled}
					onClick={() => {
						onModelChange({
							providerId: currentModel.providerId,
							model: currentModel.model,
							effort: currentEffort,
							...(fastTierEnabled ? {} : { serviceTier: fastTier.id }),
							...(currentModel.contextWindow !== undefined
								? { contextWindow: currentModel.contextWindow }
								: {}),
						});
					}}
					title={fastTierTooltip}
					aria-pressed={fastTierEnabled}
					aria-label={`${fastTierLabel} mode`}
					className={`flex items-center rounded px-1.5 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
						fastTierEnabled
							? "text-brand hover:text-ember"
							: "text-dark-400 hover:text-dark-200"
					}`}
				>
					<Zap size={14} aria-hidden="true" />
				</button>
			)}
		</div>
	);
}

export interface ResolvedModelSelectorCurrentModel {
	model: BrowserChatModel | undefined;
	providerId: string;
	selectable: boolean;
}

export function resolveModelSelectorCurrentModel(params: {
	model: string | null;
	models: BrowserChatModel[];
	providerId: string | null;
}): ResolvedModelSelectorCurrentModel {
	const currentProviderId = resolveCurrentProviderId(params);
	const catalogModel = resolveCurrentModel({
		model: params.model,
		models: params.models,
		providerId: currentProviderId,
	});
	if (catalogModel) {
		return {
			model: catalogModel,
			providerId: currentProviderId,
			selectable: true,
		};
	}

	if (params.providerId) {
		return {
			model: createUnavailableChatModel({
				model: params.model,
				providerId: params.providerId,
			}),
			providerId: params.providerId,
			selectable: false,
		};
	}

	return {
		model: params.models[0],
		providerId: currentProviderId,
		selectable: params.models.length > 0,
	};
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
		(params.providerId || "")
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

function createUnavailableChatModel(params: {
	model: string | null;
	providerId: string;
}): BrowserChatModel {
	const model = params.model?.trim() || "Legacy model";
	return {
		providerId: params.providerId,
		providerDisplayName: formatProviderDisplayName(params.providerId),
		id: model,
		model,
		displayName: model,
		description: "",
		isDefault: false,
		defaultReasoningEffort: DEFAULT_EFFORT,
		supportedReasoningEfforts: [],
		serviceTiers: [],
	};
}

function formatProviderDisplayName(providerId: string): string {
	if (providerId === "claude") {
		return "Claude";
	}
	if (providerId === "codex") {
		return "Codex";
	}
	if (providerId === "pi") {
		return "Pi";
	}
	return providerId;
}

function modelMatches(
	candidate: BrowserChatModel,
	model: string | null,
): boolean {
	if (!model) {
		return false;
	}
	return candidate.model === model || candidate.id === model;
}

function resolveVisibleEffort(
	effort: string | null,
	model: BrowserChatModel | undefined,
): EffortLevel {
	if (!model) {
		return resolveCurrentEffort(effort);
	}

	return compatibleEffortForChatModel(resolveCurrentEffort(effort), model);
}

export function compatibleEffortForChatModel(
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

export function effortLevelsForChatModel(
	model: BrowserChatModel | undefined,
): EffortLevel[] {
	if (!model) {
		return [DEFAULT_EFFORT];
	}

	const providerLevels = model.supportedReasoningEfforts.filter(
		(level): level is EffortLevel => isEffortLevel(level),
	);
	if (providerLevels.length === 0) {
		return isEffortLevel(model.defaultReasoningEffort)
			? [model.defaultReasoningEffort]
			: [DEFAULT_EFFORT];
	}

	return EFFORT_MENU_LEVELS.filter((level) => providerLevels.includes(level));
}

export function resolveFastServiceTier(
	model: BrowserChatModel | undefined,
): BrowserChatModel["serviceTiers"][number] | undefined {
	return model?.serviceTiers?.[0];
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
