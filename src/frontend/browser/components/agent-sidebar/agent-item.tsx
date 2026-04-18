import { ChevronDown, ChevronRight } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useWs } from "../../contexts/websocket-context.tsx";
import type { AgentEntry, AgentReorderPosition } from "../../stores/agents.ts";
import type { SessionEntry, SessionRef } from "../../stores/sessions.ts";
import { useWorkspaceViewStore } from "../../stores/workspace-view.ts";
import { SessionItem } from "./session-item.tsx";

interface AgentItemProps {
	agent: AgentEntry;
	isActive: boolean;
	isExpanded: boolean;
	isDragging: boolean;
	dropIndicator: AgentReorderPosition | null;
	onAttachRow: (element: HTMLDivElement | null) => void;
	activeSession: SessionRef | null;
	sessions: SessionEntry[];
	onRowPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
	onToggle: () => void;
}

export function AgentItem({
	agent,
	isActive,
	isExpanded,
	isDragging,
	dropIndicator,
	onAttachRow,
	activeSession,
	sessions,
	onRowPointerDown,
	onToggle,
}: AgentItemProps) {
	const { sendCommand, switchSession } = useWs();
	const openWorkspace = useWorkspaceViewStore((state) => state.openWorkspace);

	return (
		<div ref={onAttachRow} className="relative space-y-0.5">
			{dropIndicator === "before" && (
				<div className="pointer-events-none absolute inset-x-2 top-0 z-10 border-t border-dark-300/90" />
			)}
			{isActive && (
				<span
					aria-hidden="true"
					className="pointer-events-none absolute inset-y-1 left-0 w-px rounded-full bg-brand"
				/>
			)}
			<div
				role="treeitem"
				aria-expanded={isExpanded}
				tabIndex={-1}
				onPointerDown={onRowPointerDown}
				className={`flex items-center gap-2 rounded px-2 py-1 text-sm transition-colors ${
					isActive ? "text-dark-50" : "text-dark-500 hover:text-dark-300"
				} ${isDragging ? "opacity-60" : ""}`}
				style={{ paddingLeft: "12px" }}
			>
				<button
					type="button"
					onClick={onToggle}
					className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
						isDragging ? "cursor-grabbing" : "cursor-grab"
					}`}
				>
					{isExpanded ? (
						<ChevronDown size={14} className="shrink-0" />
					) : (
						<ChevronRight size={14} className="shrink-0" />
					)}
					<div className="min-w-0 flex-1 truncate text-[15px] font-semibold">
						{agent.name}
					</div>
				</button>
				<div className="flex w-8 shrink-0 justify-end">
					<button
						type="button"
						data-agent-row-ignore-drag="true"
						aria-label={`Start new session for ${agent.name}`}
						onClick={() => {
							if (!isActive && !sendCommand(`/agent ${agent.name}`)) {
								return;
							}
							if (sendCommand("/new")) {
								openWorkspace();
							}
						}}
						className="font-mono-ui flex w-full items-center justify-end text-[18px] leading-none text-dark-500 transition-colors hover:text-dark-100"
					>
						+
					</button>
				</div>
			</div>

			{isExpanded && (
				<div className="space-y-0.5">
					{sessions.length === 0 ? (
						<div className="border border-dashed border-dark-800 px-3 py-1.5 text-sm text-dark-500">
							No cached sessions for this agent yet.
						</div>
					) : (
						sessions.map((session) => (
							<SessionItem
								key={`${session.providerId}:${session.sdkSessionId}`}
								session={session}
								isActive={
									activeSession?.providerId === session.providerId &&
									activeSession.sdkSessionId === session.sdkSessionId
								}
								onSelect={() => {
									if (switchSession(agent.name, session)) {
										openWorkspace();
									}
								}}
								onRename={(title) =>
									sendCommand(
										`/session rename ${session.sdkSessionId} ${title}`,
									)
								}
								onDelete={() =>
									sendCommand(`/session delete ${session.sdkSessionId}`)
								}
							/>
						))
					)}
				</div>
			)}

			{dropIndicator === "after" && (
				<div className="pointer-events-none absolute inset-x-2 bottom-0 z-10 border-t border-dark-300/90" />
			)}
		</div>
	);
}
