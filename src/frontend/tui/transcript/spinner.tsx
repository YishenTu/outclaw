import { Text } from "ink";
import { SPINNER_FRAMES } from "../../spinner-frames.ts";
import { theme } from "../chrome/theme.ts";

interface SpinnerProps {
	label?: string;
}

export function Spinner({ label }: SpinnerProps) {
	return (
		<Text>
			<Text color={theme.accent}>{SPINNER_FRAMES[0]}</Text>
			{label ? ` ${label}` : ""}
		</Text>
	);
}
