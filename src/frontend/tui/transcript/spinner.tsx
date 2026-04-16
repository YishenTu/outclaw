import { Text } from "ink";
import { useEffect, useState } from "react";
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "../../spinner-frames.ts";
import { theme } from "../chrome/theme.ts";

interface SpinnerProps {
	label?: string;
}

export function Spinner({ label }: SpinnerProps) {
	const [i, setI] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => {
			setI((prev) => (prev + 1) % SPINNER_FRAMES.length);
		}, SPINNER_INTERVAL_MS);
		return () => clearInterval(timer);
	}, []);

	return (
		<Text>
			<Text color={theme.accent}>{SPINNER_FRAMES[i]}</Text>
			{label ? ` ${label}` : ""}
		</Text>
	);
}
