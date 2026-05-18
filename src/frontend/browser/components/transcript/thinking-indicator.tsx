import { useSpinnerFrame } from "../../../use-spinner-frame.ts";

interface ThinkingIndicatorProps {
	startedAt: number | null;
	isCompacting?: boolean;
	isWorking?: boolean;
}

export function ThinkingIndicator({
	startedAt: _startedAt,
	isCompacting = false,
	isWorking = false,
}: ThinkingIndicatorProps) {
	const frame = useSpinnerFrame();

	return (
		<div className="px-3 py-1.5 text-sm text-dark-500">
			<span className="text-ember">{frame}</span>
			<span className="ml-2">
				{isCompacting
					? "Compacting..."
					: isWorking
						? "Working..."
						: "Thinking..."}
			</span>
		</div>
	);
}
