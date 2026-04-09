import figlet from "figlet";
import { Text } from "ink";
import { theme } from "./theme.ts";

const banner = figlet.textSync("OutCLAW", { font: "ANSI Shadow" }).trimEnd();

export function HeaderBar() {
	return (
		<Text bold color={theme.brand}>
			{banner}
		</Text>
	);
}
