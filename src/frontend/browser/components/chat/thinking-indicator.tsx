import { useEffect, useState } from "react";
import {
	SPINNER_FRAMES,
	SPINNER_INTERVAL_MS,
} from "../../../spinner-frames.ts";

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
	const [frameIndex, setFrameIndex] = useState(0);

	useEffect(() => {
		const timer = window.setInterval(() => {
			setFrameIndex((current) => (current + 1) % SPINNER_FRAMES.length);
		}, SPINNER_INTERVAL_MS);
		return () => {
			window.clearInterval(timer);
		};
	}, []);

	return (
		<div className="px-3 py-1.5 text-sm text-dark-500">
			<span className="text-ember">{SPINNER_FRAMES[frameIndex]}</span>
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
