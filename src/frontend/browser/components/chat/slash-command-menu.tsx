import type { CommandEntry } from "../../stores/slash-commands.ts";
import { DropupMenu } from "./dropup-menu.tsx";

interface SlashCommandMenuProps {
	commands: CommandEntry[];
	selectedIndex: number;
	onSelect: (command: CommandEntry) => void;
	emptyMessage?: string;
}

export function SlashCommandMenu({
	commands,
	selectedIndex,
	onSelect,
	emptyMessage,
}: SlashCommandMenuProps) {
	return (
		<DropupMenu
			items={commands}
			selectedIndex={selectedIndex}
			onSelect={onSelect}
			emptyMessage={emptyMessage}
			itemKey={(command) => command.name}
			renderItem={(command) => (
				<>
					<span className="shrink-0 font-semibold text-dark-100">
						{command.displayPrefix ?? "/"}
						{command.name}
					</span>
					<span className="min-w-0 truncate text-dark-400">
						{command.description}
					</span>
					{command.source === "skill" && (
						<span className="font-mono-ui ml-auto shrink-0 text-[10px] uppercase tracking-[0.14em] text-dark-500">
							Skill
						</span>
					)}
				</>
			)}
		/>
	);
}
