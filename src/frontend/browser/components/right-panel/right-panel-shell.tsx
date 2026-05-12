import { ChevronUp, PanelRightOpen } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode, Ref } from "react";
import { ActiveTabUnderline } from "../active-tab-underline.tsx";

export interface RightPanelTabOption<T extends string> {
	id: T;
	label: string;
	icon: ReactNode;
	badge?: number;
}

interface RightPanelTabBarProps<T extends string> {
	activeTab: T;
	tabs: readonly RightPanelTabOption<T>[];
	onCollapse?: () => void;
	onSelectTab: (tab: T) => void;
}

export function RightPanelTabBar<T extends string>({
	activeTab,
	tabs,
	onCollapse,
	onSelectTab,
}: RightPanelTabBarProps<T>) {
	return (
		<div className="flex h-12 items-stretch gap-2 border-b border-dark-800 px-3">
			{onCollapse ? (
				<button
					type="button"
					onClick={onCollapse}
					className="flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
					aria-label="Collapse right sidebar"
				>
					<PanelRightOpen size={15} />
				</button>
			) : null}
			<div className="flex min-w-0 flex-1 items-stretch gap-2">
				{tabs.map((tab) => (
					<div
						key={tab.id}
						className={`font-mono-ui relative flex shrink-0 items-center pt-px text-[11px] uppercase tracking-[0.12em] transition-colors ${
							activeTab === tab.id
								? "text-dark-50"
								: "text-dark-500 hover:text-dark-200"
						}`}
					>
						{activeTab === tab.id ? <ActiveTabUnderline /> : null}
						<button
							type="button"
							onClick={() => onSelectTab(tab.id)}
							className="flex h-full items-center gap-1.5 pl-2 pr-3"
						>
							{tab.icon}
							<span>{tab.label}</span>
							{tab.badge && tab.badge > 0 ? (
								<span className="rounded bg-dark-800 px-1.5 py-0.5 text-[10px] leading-none text-dark-100">
									{tab.badge}
								</span>
							) : null}
						</button>
					</div>
				))}
			</div>
		</div>
	);
}

interface RightPanelSplitShellProps {
	contentRef?: Ref<HTMLDivElement>;
	upperHeight: string | undefined;
	lowerHeight: string;
	lowerCollapsed: boolean;
	isResizing: boolean;
	onResizeMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
	onExpandLower: () => void;
	upperContent: ReactNode;
	lowerHeader: ReactNode;
	lowerContent: ReactNode;
	collapsedLowerLabel?: string;
}

export function RightPanelSplitShell({
	contentRef,
	upperHeight,
	lowerHeight,
	lowerCollapsed,
	isResizing,
	onResizeMouseDown,
	onExpandLower,
	upperContent,
	lowerHeader,
	lowerContent,
	collapsedLowerLabel = "Terminal",
}: RightPanelSplitShellProps) {
	return (
		<div
			ref={contentRef}
			className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
		>
			<div
				style={{ height: lowerCollapsed ? undefined : upperHeight }}
				className={`min-h-0 overflow-hidden ${
					isResizing ? "" : "transition-[height] duration-200"
				} ${lowerCollapsed ? "flex-1" : ""}`}
			>
				<div className="h-full min-h-0 overflow-hidden">{upperContent}</div>
			</div>

			{lowerCollapsed ? (
				<div className="border-t border-dark-800 px-4 py-3">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={onExpandLower}
							className="flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
							aria-label={`Expand ${collapsedLowerLabel.toLowerCase()} panel`}
						>
							<ChevronUp size={14} />
						</button>
						<span className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
							{collapsedLowerLabel}
						</span>
					</div>
				</div>
			) : (
				<>
					<button
						type="button"
						aria-label="Resize right panel split"
						onMouseDown={onResizeMouseDown}
						className="relative h-1 shrink-0 cursor-row-resize transition-colors hover:bg-dark-600"
					>
						<div className="absolute inset-x-0 top-0 h-px bg-dark-800" />
					</button>

					<div
						style={{ height: lowerHeight }}
						className={`flex min-h-0 flex-col overflow-hidden ${
							isResizing ? "" : "transition-[height] duration-200"
						}`}
					>
						{lowerHeader}
						<div className="min-h-0 flex-1 overflow-hidden">{lowerContent}</div>
					</div>
				</>
			)}
		</div>
	);
}
