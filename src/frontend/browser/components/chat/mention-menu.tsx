import { FileText, Folder } from "lucide-react";
import type { WorkspaceFileEntry } from "../../../../common/protocol.ts";
import { DropupMenu } from "./dropup-menu.tsx";

interface MentionMenuProps {
	entries: WorkspaceFileEntry[];
	selectedIndex: number;
	onSelect: (entry: WorkspaceFileEntry) => void;
}

export function MentionMenu({
	entries,
	selectedIndex,
	onSelect,
}: MentionMenuProps) {
	return (
		<DropupMenu
			items={entries}
			selectedIndex={selectedIndex}
			onSelect={onSelect}
			itemKey={(entry) => `${entry.kind}:${entry.path}`}
			renderItem={(entry) => (
				<>
					{entry.kind === "directory" ? (
						<Folder size={14} className="shrink-0 text-dark-300" />
					) : (
						<FileText size={14} className="shrink-0 text-dark-300" />
					)}
					<span className="min-w-0 truncate text-dark-100">
						{entry.kind === "directory" ? `${entry.path}/` : entry.path}
					</span>
				</>
			)}
		/>
	);
}
