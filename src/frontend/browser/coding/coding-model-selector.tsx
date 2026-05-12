import { Zap } from "lucide-react";
import { type EffortLevel, isEffortLevel } from "../../../common/commands.ts";
import type { BrowserCodingModel } from "../../../common/protocol.ts";
import {
	formatEffortLabel as formatKnownEffortLabel,
	SelectorDropdown,
} from "../components/chat/model-selector-controls.tsx";

function formatEffortLabel(value: string): string {
	if (isEffortLevel(value)) {
		return formatKnownEffortLabel(value);
	}
	return value.charAt(0).toUpperCase() + value.slice(1);
}

interface CodingModelSelectorProps {
	models: BrowserCodingModel[];
	selectedModelId: string | undefined;
	selectedEffort: string | undefined;
	fastTierEnabled: boolean;
	disabled?: boolean;
	onSelectModel(modelId: string): void;
	onSelectEffort(effort: EffortLevel): void;
	onToggleFastTier(enabled: boolean): void;
}

export function CodingModelSelector({
	models,
	selectedModelId,
	selectedEffort,
	fastTierEnabled,
	disabled = false,
	onSelectModel,
	onSelectEffort,
	onToggleFastTier,
}: CodingModelSelectorProps) {
	const selectedModel =
		models.find((entry) => entry.id === selectedModelId) ?? models[0];
	const supportedEfforts = [
		...(selectedModel?.supportedReasoningEfforts ?? []),
	].reverse();
	const effortLabel = selectedEffort ? formatEffortLabel(selectedEffort) : "—";
	const modelLabel = selectedModel?.displayName ?? "Model";
	const noModels = models.length === 0;
	// Codex advertises a per-model `serviceTiers` array on `model/list`; if the
	// selected model exposes a non-default tier, expose a Fast toggle. The
	// canonical tier id (e.g. `priority`) is what gets sent to the backend.
	const fastTier = selectedModel?.serviceTiers?.[0];
	const fastTierLabel = fastTier?.name ?? "Fast";
	const fastTierTooltip = fastTier?.description ?? "";

	return (
		<div className="flex items-center gap-1.5">
			<SelectorDropdown
				label={noModels ? "No models" : modelLabel}
				items={models.map((model) => ({
					id: model.id,
					label: model.displayName,
				}))}
				selectedId={selectedModel?.id}
				disabled={disabled || noModels}
				minWidthClassName="min-w-[7rem]"
				onSelect={(item) => {
					onSelectModel(item.id);
					return true;
				}}
			/>

			<SelectorDropdown
				label={`Thinking: ${effortLabel}`}
				items={supportedEfforts.map((effort) => ({
					id: effort,
					label: formatEffortLabel(effort),
					disabled: !isEffortLevel(effort),
				}))}
				selectedId={selectedEffort}
				disabled={disabled || supportedEfforts.length === 0}
				minWidthClassName="min-w-[8.5rem]"
				onSelect={(item) => {
					if (!isEffortLevel(item.id)) {
						return false;
					}
					onSelectEffort(item.id);
					return true;
				}}
			/>

			{fastTier && (
				<button
					type="button"
					disabled={disabled}
					onClick={() => onToggleFastTier(!fastTierEnabled)}
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
