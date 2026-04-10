import { Box, Text, useStdout } from "ink";
import { theme } from "../chrome/theme.ts";
import type { CommandMenuItem } from "./state.ts";
import { visibleWindow } from "./state.ts";

interface CommandMenuProps {
	items: CommandMenuItem[];
	selectedIndex: number;
}

export function CommandMenu({ items, selectedIndex }: CommandMenuProps) {
	const { stdout } = useStdout();
	const columns = stdout?.columns ?? 80;
	const { items: visible, startIndex } = visibleWindow(items, selectedIndex);
	const maxCommandWidth = Math.max(...visible.map((i) => i.command.length));
	const gap = 4;
	const descriptionWidth = columns - maxCommandWidth - gap - 2;

	return (
		<Box flexDirection="column" paddingX={1}>
			{visible.map((item, index) => {
				const isSelected = startIndex + index === selectedIndex;
				const padding = " ".repeat(maxCommandWidth - item.command.length + gap);
				const description =
					descriptionWidth > 0
						? truncate(item.description, descriptionWidth)
						: "";

				return (
					<Text key={item.command}>
						<Text
							color={isSelected ? theme.accent : undefined}
							bold={isSelected}
						>
							{item.command}
						</Text>
						<Text dimColor>
							{padding}
							{description}
						</Text>
					</Text>
				);
			})}
		</Box>
	);
}

function truncate(text: string, maxWidth: number): string {
	if (text.length <= maxWidth) return text;
	return `${text.slice(0, maxWidth - 1)}…`;
}
