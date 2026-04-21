import { Text } from "ink";
import { useSpinnerFrame } from "../../use-spinner-frame.ts";
import { theme } from "../chrome/theme.ts";

interface SpinnerProps {
	label?: string;
}

export function Spinner({ label }: SpinnerProps) {
	const frame = useSpinnerFrame();

	return (
		<Text>
			<Text color={theme.accent}>{frame}</Text>
			{label ? ` ${label}` : ""}
		</Text>
	);
}
