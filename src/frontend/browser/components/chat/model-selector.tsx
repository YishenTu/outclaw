import { useEffect, useRef, useState } from "react";
import {
	DEFAULT_EFFORT,
	DEFAULT_MODEL,
	type EffortLevel,
	isEffortLevel,
	isOpusOnlyEffort,
} from "../../../../common/commands.ts";
import {
	MODEL_ALIAS_LIST,
	type ModelAlias,
	resolveModelAlias,
} from "../../../../common/models.ts";

const EFFORT_MENU_LEVELS: readonly EffortLevel[] = [
	"max",
	"xhigh",
	"high",
	"medium",
	"low",
];

const EFFORT_LABELS: Record<EffortLevel, string> = {
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "XHigh",
	max: "Max",
};

const MODEL_LABELS: Record<ModelAlias, string> = {
	opus: "Opus",
	sonnet: "Sonnet",
	haiku: "Haiku",
};

function resolveCurrentModelAlias(model: string | null): ModelAlias {
	if (!model) {
		return DEFAULT_MODEL as ModelAlias;
	}

	for (const alias of MODEL_ALIAS_LIST) {
		if (model === alias || resolveModelAlias(alias) === model) {
			return alias;
		}
	}

	return DEFAULT_MODEL as ModelAlias;
}

function resolveCurrentEffort(effort: string | null): EffortLevel {
	return effort && isEffortLevel(effort) ? effort : DEFAULT_EFFORT;
}

function formatEffortLabel(effort: EffortLevel): string {
	return EFFORT_LABELS[effort];
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
	const [modelOpen, setModelOpen] = useState(false);
	const [effortOpen, setEffortOpen] = useState(false);
	const modelRef = useRef<HTMLDivElement | null>(null);
	const effortRef = useRef<HTMLDivElement | null>(null);
	const currentModel = resolveCurrentModelAlias(model);
	const currentEffort = resolveCurrentEffort(effort);
	const visibleEffortLevels = EFFORT_MENU_LEVELS.filter(
		(level) => currentModel === "opus" || !isOpusOnlyEffort(level),
	);

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

	return (
		<div className="flex items-center gap-1.5">
			<div ref={modelRef} className="relative">
				<button
					type="button"
					disabled={disabled}
					onClick={() => {
						setModelOpen((current) => !current);
						setEffortOpen(false);
					}}
					className="flex items-center rounded px-2 py-0.5 text-xs text-dark-400 transition-colors hover:text-dark-200 disabled:cursor-not-allowed disabled:opacity-40"
				>
					<span>{MODEL_LABELS[currentModel]}</span>
				</button>
				{modelOpen && (
					<div className="absolute bottom-full left-0 z-50 mb-2 min-w-[7rem] overflow-hidden rounded-[16px] border border-dark-800 bg-dark-900 shadow-lg">
						{MODEL_ALIAS_LIST.map((alias) => (
							<button
								key={alias}
								type="button"
								onClick={() => {
									if (onModelChange(alias)) {
										setModelOpen(false);
									}
								}}
								className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
									alias === currentModel
										? "bg-dark-800 text-dark-100"
										: "text-dark-300 hover:bg-dark-800/70"
								}`}
							>
								{MODEL_LABELS[alias]}
							</button>
						))}
					</div>
				)}
			</div>

			<div ref={effortRef} className="relative">
				<button
					type="button"
					disabled={disabled}
					onClick={() => {
						setEffortOpen((current) => !current);
						setModelOpen(false);
					}}
					className="flex items-center rounded px-2 py-0.5 text-xs text-dark-400 transition-colors hover:text-dark-200 disabled:cursor-not-allowed disabled:opacity-40"
				>
					<span>Thinking: {formatEffortLabel(currentEffort)}</span>
				</button>
				{effortOpen && (
					<div className="absolute bottom-full left-0 z-50 mb-2 min-w-[8.5rem] overflow-hidden rounded-[16px] border border-dark-800 bg-dark-900 shadow-lg">
						{visibleEffortLevels.map((level) => (
							<button
								key={level}
								type="button"
								onClick={() => {
									if (onEffortChange(level)) {
										setEffortOpen(false);
									}
								}}
								className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
									level === currentEffort
										? "bg-dark-800 text-dark-100"
										: "text-dark-300 hover:bg-dark-800/70"
								}`}
							>
								{formatEffortLabel(level)}
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
