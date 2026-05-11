import { Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type EffortLevel, isEffortLevel } from "../../../common/commands.ts";
import type { BrowserCodingModel } from "../../../common/protocol.ts";

const EFFORT_LABELS: Record<EffortLevel, string> = {
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "XHigh",
	max: "Max",
};

function formatEffortLabel(value: string): string {
	if (isEffortLevel(value)) {
		return EFFORT_LABELS[value];
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
	const [modelOpen, setModelOpen] = useState(false);
	const [effortOpen, setEffortOpen] = useState(false);
	const modelRef = useRef<HTMLDivElement | null>(null);
	const effortRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		function handlePointerDown(event: MouseEvent) {
			if (
				modelRef.current &&
				!modelRef.current.contains(event.target as Node)
			) {
				setModelOpen(false);
			}
			if (
				effortRef.current &&
				!effortRef.current.contains(event.target as Node)
			) {
				setEffortOpen(false);
			}
		}

		document.addEventListener("mousedown", handlePointerDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
		};
	}, []);

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
			<div ref={modelRef} className="relative">
				<button
					type="button"
					disabled={disabled || noModels}
					onClick={() => {
						setModelOpen((current) => !current);
						setEffortOpen(false);
					}}
					className="flex items-center rounded px-2 py-0.5 text-xs text-dark-400 transition-colors hover:text-dark-200 disabled:cursor-not-allowed disabled:opacity-40"
				>
					<span>{noModels ? "No models" : modelLabel}</span>
				</button>
				{modelOpen && !noModels && (
					<div className="absolute bottom-full left-0 z-50 mb-2 min-w-[7rem] overflow-hidden rounded-[16px] border border-dark-800 bg-dark-900 shadow-lg">
						{models.map((model) => (
							<button
								key={model.id}
								type="button"
								onClick={() => {
									onSelectModel(model.id);
									setModelOpen(false);
								}}
								className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
									model.id === selectedModel?.id
										? "bg-dark-800 text-dark-100"
										: "text-dark-300 hover:bg-dark-800/70"
								}`}
							>
								{model.displayName}
							</button>
						))}
					</div>
				)}
			</div>

			<div ref={effortRef} className="relative">
				<button
					type="button"
					disabled={disabled || supportedEfforts.length === 0}
					onClick={() => {
						setEffortOpen((current) => !current);
						setModelOpen(false);
					}}
					className="flex items-center rounded px-2 py-0.5 text-xs text-dark-400 transition-colors hover:text-dark-200 disabled:cursor-not-allowed disabled:opacity-40"
				>
					<span>Thinking: {effortLabel}</span>
				</button>
				{effortOpen && supportedEfforts.length > 0 && (
					<div className="absolute bottom-full left-0 z-50 mb-2 min-w-[8.5rem] overflow-hidden rounded-[16px] border border-dark-800 bg-dark-900 shadow-lg">
						{supportedEfforts.map((effort) => (
							<button
								key={effort}
								type="button"
								disabled={!isEffortLevel(effort)}
								onClick={() => {
									if (!isEffortLevel(effort)) {
										return;
									}
									onSelectEffort(effort);
									setEffortOpen(false);
								}}
								className={`block w-full px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
									effort === selectedEffort
										? "bg-dark-800 text-dark-100"
										: "text-dark-300 hover:bg-dark-800/70"
								}`}
							>
								{formatEffortLabel(effort)}
							</button>
						))}
					</div>
				)}
			</div>

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
