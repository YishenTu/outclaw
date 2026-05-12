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
import {
	formatEffortLabel,
	SelectorDropdown,
} from "./model-selector-controls.tsx";

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
	model: string | null;
	effort: string | null;
	disabled?: boolean;
	onModelChange: (model: ModelAlias) => boolean;
	onEffortChange: (effort: EffortLevel) => boolean;
}

export function ModelSelector({
	model,
	effort,
	disabled = false,
	onModelChange,
	onEffortChange,
}: ModelSelectorProps) {
	const currentModel = resolveCurrentModelAlias(model);
	const currentEffort = resolveCurrentEffort(effort);
	const visibleEffortLevels = visibleEffortLevelsForModel(currentModel);

	return (
		<div className="flex items-center gap-1.5">
			<SelectorDropdown
				label={MODEL_LABELS[currentModel]}
				items={MODEL_ALIAS_LIST.map((alias) => ({
					id: alias,
					label: MODEL_LABELS[alias],
				}))}
				selectedId={currentModel}
				disabled={disabled}
				minWidthClassName="min-w-[7rem]"
				onSelect={(item) => onModelChange(item.id as ModelAlias)}
			/>

			<SelectorDropdown
				label={`Thinking: ${formatEffortLabel(currentEffort)}`}
				items={visibleEffortLevels.map((level) => ({
					id: level,
					label: formatEffortLabel(level),
				}))}
				selectedId={currentEffort}
				disabled={disabled}
				minWidthClassName="min-w-[8.5rem]"
				onSelect={(item) => onEffortChange(item.id as EffortLevel)}
			/>
		</div>
	);
}

export { formatEffortLabel };
