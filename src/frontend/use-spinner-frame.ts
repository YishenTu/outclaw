import { useEffect, useState } from "react";
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "./spinner-frames.ts";

export function useSpinnerFrame(): string {
	const [frameIndex, setFrameIndex] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => {
			setFrameIndex((current) => (current + 1) % SPINNER_FRAMES.length);
		}, SPINNER_INTERVAL_MS);
		return () => {
			clearInterval(timer);
		};
	}, []);

	return SPINNER_FRAMES[frameIndex] ?? SPINNER_FRAMES[0];
}
