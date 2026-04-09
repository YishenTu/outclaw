import { Text } from "ink";
import { useEffect, useState } from "react";

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface SpinnerProps {
	label?: string;
}

export function Spinner({ label }: SpinnerProps) {
	const [i, setI] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => {
			setI((prev) => (prev + 1) % frames.length);
		}, 80);
		return () => clearInterval(timer);
	}, []);

	return (
		<Text>
			<Text color="cyan">{frames[i]}</Text>
			{label ? ` ${label}` : ""}
		</Text>
	);
}
