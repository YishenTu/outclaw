import { Box, Text } from "ink";
import type { WorkspaceFileEntry } from "../../../common/protocol.ts";
import { theme } from "../chrome/theme.ts";
import { visibleMentionWindow } from "./state.ts";

interface MentionMenuProps {
	items: WorkspaceFileEntry[];
	selectedIndex: number;
}

export function MentionMenu({ items, selectedIndex }: MentionMenuProps) {
	const { items: visible, startIndex } = visibleMentionWindow(
		items,
		selectedIndex,
	);

	return (
		<Box flexDirection="column" paddingX={1}>
			{visible.map((item, index) => {
				const isSelected = startIndex + index === selectedIndex;
				const display = item.kind === "directory" ? `${item.path}/` : item.path;
				return (
					<Text key={`${item.kind}:${item.path}`}>
						<Text dimColor>+ </Text>
						<Text
							color={isSelected ? theme.accent : undefined}
							bold={isSelected}
						>
							{display}
						</Text>
					</Text>
				);
			})}
		</Box>
	);
}
