import { FileDiff, FileText, MessageSquareText } from "lucide-react";
import { BrowserTabStrip } from "../components/browser-tab-strip.tsx";
import {
	type CodingTab,
	codingTabId,
	isCodingDiffTab,
	isCodingFileTab,
	isPendingCodingTab,
} from "./coding-store.ts";

interface CodingTabBarProps {
	tabs: CodingTab[];
	activeTabId: string | undefined;
	leftCollapsed?: boolean;
	rightCollapsed?: boolean;
	canAdd?: boolean;
	onExpandLeft?: () => void;
	onExpandRight?: () => void;
	onAdd?: () => void;
	onSelect(tab: CodingTab): void;
	onClose(tab: CodingTab): void;
	onRename?(tab: CodingTab, title: string): void;
}

export function CodingTabBar({
	tabs,
	activeTabId,
	leftCollapsed = false,
	rightCollapsed = false,
	canAdd = true,
	onExpandLeft,
	onExpandRight,
	onAdd,
	onSelect,
	onClose,
	onRename,
}: CodingTabBarProps) {
	return (
		<BrowserTabStrip
			items={tabs.map((tab) => {
				const kind = codingTabKind(tab);
				return {
					id: codingTabId(tab),
					value: tab,
					title: tab.title,
					icon: <CodingTabKindIcon kind={kind} />,
					closable: true,
					renamable:
						onRename !== undefined &&
						kind === "session" &&
						!isPendingCodingTab(tab),
					closeLabel: `Close ${tab.title}`,
				};
			})}
			activeId={activeTabId}
			leftCollapsed={leftCollapsed}
			rightCollapsed={rightCollapsed}
			onExpandLeft={onExpandLeft}
			onExpandRight={onExpandRight}
			onSelect={onSelect}
			onClose={onClose}
			onRename={onRename}
			textSizeClassName="text-[14px]"
			addButton={
				onAdd
					? {
							ariaLabel: "New coding session",
							title: canAdd
								? "New coding session"
								: "Select a repository to start a new session",
							disabled: !canAdd,
							onClick: onAdd,
						}
					: undefined
			}
		/>
	);
}

type CodingTabKind = "session" | "file" | "diff";

function codingTabKind(tab: CodingTab): CodingTabKind {
	if (isCodingDiffTab(tab)) {
		return "diff";
	}
	if (isCodingFileTab(tab)) {
		return "file";
	}
	return "session";
}

function CodingTabKindIcon({ kind }: { kind: CodingTabKind }) {
	if (kind === "diff") {
		return <FileDiff size={14} className="shrink-0" />;
	}
	if (kind === "file") {
		return <FileText size={14} className="shrink-0" />;
	}
	return <MessageSquareText size={14} className="shrink-0" />;
}
