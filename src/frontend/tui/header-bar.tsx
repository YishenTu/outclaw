import figlet from "figlet";
import { Text } from "ink";

const banner = figlet.textSync("OutCLAW", { font: "ANSI Shadow" }).trimEnd();

export function HeaderBar() {
	return (
		<Text bold color="#f97316">
			{banner}
		</Text>
	);
}
