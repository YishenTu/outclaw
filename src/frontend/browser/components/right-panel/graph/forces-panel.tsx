import {
	FORCE_SLIDERS,
	type ForceSliderSpec,
	type GraphForces,
} from "./graph-forces.ts";

export function ForcesPanel({
	forces,
	onChange,
	onReset,
}: {
	forces: GraphForces;
	onChange: <K extends keyof GraphForces>(
		key: K,
		value: GraphForces[K],
	) => void;
	onReset: () => void;
}) {
	return (
		<div className="w-60 rounded border border-dark-800 bg-dark-950/95 p-3 shadow-lg backdrop-blur">
			<div className="mb-2 flex items-center justify-between">
				<span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-dark-400">
					Forces
				</span>
				<button
					type="button"
					onClick={onReset}
					className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-dark-500 transition-colors hover:text-dark-100"
				>
					reset
				</button>
			</div>
			<div className="flex flex-col gap-2.5">
				{FORCE_SLIDERS.map((spec) => (
					<ForceSliderRow
						key={spec.key}
						spec={spec}
						value={forces[spec.key]}
						onChange={(next) => onChange(spec.key, next)}
					/>
				))}
			</div>
		</div>
	);
}

function ForceSliderRow({
	spec,
	value,
	onChange,
}: {
	spec: ForceSliderSpec;
	value: number;
	onChange: (next: number) => void;
}) {
	return (
		<label className="flex flex-col gap-1">
			<div className="flex items-baseline justify-between">
				<span className="text-[11px] text-dark-200">{spec.label}</span>
				<span className="font-mono-ui text-[10px] tabular-nums text-dark-500">
					{formatForceValue(spec, value)}
				</span>
			</div>
			<input
				type="range"
				min={spec.min}
				max={spec.max}
				step={spec.step}
				value={value}
				onChange={(event) => onChange(Number(event.target.value))}
				className="h-1 w-full cursor-pointer appearance-none rounded bg-dark-800 accent-dark-100"
			/>
		</label>
	);
}

function formatForceValue(spec: ForceSliderSpec, value: number): string {
	if (spec.step >= 1) {
		return value.toFixed(0);
	}
	if (spec.step >= 0.1) {
		return value.toFixed(1);
	}
	return value.toFixed(2);
}
