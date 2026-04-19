import { PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWs } from "../../contexts/websocket-context.tsx";
import type { AgentReorderPosition } from "../../stores/agents.ts";
import { useAgentsStore } from "../../stores/agents.ts";
import { useSessionsStore } from "../../stores/sessions.ts";
import { AgentItem } from "./agent-item.tsx";
import {
	type AgentDropIndicator,
	type AgentRowBounds,
	resolveAgentDropIndicator,
} from "./resolve-agent-drop-indicator.ts";
import { SidebarRuntimeStatus } from "./sidebar-runtime-status.tsx";

interface AgentSidebarProps {
	onCollapse?: () => void;
}

export function AgentSidebar({ onCollapse }: AgentSidebarProps) {
	const { sendCommand } = useWs();
	const dragThreshold = 4;
	const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>(
		{},
	);
	const [trackingAgentId, setTrackingAgentId] = useState<string | null>(null);
	const [draggingAgentId, setDraggingAgentId] = useState<string | null>(null);
	const [dropIndicator, setDropIndicator] = useState<{
		agentId: string;
		position: AgentReorderPosition;
	} | null>(null);
	const rowElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
	const pendingDragRef = useRef<{
		agentId: string;
		startX: number;
		startY: number;
	} | null>(null);
	const draggingAgentIdRef = useRef<string | null>(null);
	const dropIndicatorRef = useRef<AgentDropIndicator | null>(null);
	const suppressToggleRef = useRef(false);
	const agents = useAgentsStore((state) => state.agents);
	const activeAgentId = useAgentsStore((state) => state.activeAgentId);
	const reorderAgents = useAgentsStore((state) => state.reorderAgents);
	const sessionsByAgent = useSessionsStore((state) => state.sessionsByAgent);
	const activeSessionByAgent = useSessionsStore(
		(state) => state.activeSessionByAgent,
	);

	useEffect(() => {
		if (!activeAgentId) {
			return;
		}

		setExpandedAgents((current) =>
			current[activeAgentId] ? current : { ...current, [activeAgentId]: true },
		);
	}, [activeAgentId]);

	const attachRow = useCallback(
		(agentId: string, element: HTMLDivElement | null) => {
			if (element) {
				rowElementsRef.current.set(agentId, element);
				return;
			}

			rowElementsRef.current.delete(agentId);
		},
		[],
	);

	const updateDropIndicator = useCallback(
		(pointerY: number) => {
			const sourceAgentId = draggingAgentIdRef.current;
			if (!sourceAgentId) {
				return;
			}

			const rows: AgentRowBounds[] = agents.flatMap((agent) => {
				const element = rowElementsRef.current.get(agent.agentId);
				if (!element) {
					return [];
				}

				const bounds = element.getBoundingClientRect();
				return [
					{
						agentId: agent.agentId,
						top: bounds.top,
						height: bounds.height,
					},
				];
			});

			const nextIndicator = resolveAgentDropIndicator(
				rows,
				sourceAgentId,
				pointerY,
			);
			dropIndicatorRef.current = nextIndicator;
			setDropIndicator(nextIndicator);
		},
		[agents],
	);

	useEffect(() => {
		if (!trackingAgentId) {
			return;
		}

		function handlePointerMove(event: PointerEvent) {
			const pendingDrag = pendingDragRef.current;
			if (!pendingDrag) {
				return;
			}

			if (!draggingAgentIdRef.current) {
				const movedX = Math.abs(event.clientX - pendingDrag.startX);
				const movedY = Math.abs(event.clientY - pendingDrag.startY);
				if (Math.max(movedX, movedY) < dragThreshold) {
					return;
				}

				draggingAgentIdRef.current = pendingDrag.agentId;
				suppressToggleRef.current = true;
				setDraggingAgentId(pendingDrag.agentId);
			}

			updateDropIndicator(event.clientY);
		}

		function finishDrag(commit: boolean) {
			const wasDragging = draggingAgentIdRef.current !== null;
			const sourceAgentId = draggingAgentIdRef.current;
			const indicator = dropIndicatorRef.current;
			pendingDragRef.current = null;
			draggingAgentIdRef.current = null;
			dropIndicatorRef.current = null;
			setTrackingAgentId(null);
			setDraggingAgentId(null);
			setDropIndicator(null);

			if (!wasDragging) {
				suppressToggleRef.current = false;
				return;
			}

			if (!commit || !sourceAgentId || !indicator) {
				return;
			}

			reorderAgents(sourceAgentId, indicator.agentId, indicator.position);
		}

		function handlePointerUp() {
			finishDrag(true);
		}

		function handlePointerCancel() {
			finishDrag(false);
		}

		function handleWindowBlur() {
			finishDrag(false);
		}

		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		window.addEventListener("pointercancel", handlePointerCancel);
		window.addEventListener("blur", handleWindowBlur);

		return () => {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerCancel);
			window.removeEventListener("blur", handleWindowBlur);
		};
	}, [reorderAgents, trackingAgentId, updateDropIndicator]);

	useEffect(() => {
		if (!draggingAgentId) {
			document.body.style.userSelect = "";
			return;
		}

		document.body.style.userSelect = "none";
		return () => {
			document.body.style.userSelect = "";
		};
	}, [draggingAgentId]);

	return (
		<div className="flex h-full flex-col bg-dark-950">
			<div className="flex h-12 items-center border-b border-dark-800 px-3">
				<img
					src="/logo.png"
					alt=""
					aria-hidden="true"
					className="mr-2 h-5 w-5 shrink-0 rounded-[4px] object-cover"
				/>
				<div className="font-display text-[14px] font-semibold uppercase leading-tight tracking-[0.32em] text-parchment">
					OUTCLAW
				</div>
				<div className="flex-1" />
				{onCollapse && (
					<button
						type="button"
						onClick={onCollapse}
						className="flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
						aria-label="Collapse left sidebar"
					>
						<PanelLeftOpen size={15} />
					</button>
				)}
			</div>

			<div className="flex h-8 shrink-0 items-center border-b border-dark-800 px-3">
				<div className="font-mono-ui text-[11px] uppercase tracking-[0.22em] text-dark-500">
					Agents and sessions
				</div>
			</div>

			<div className="flex-1 overflow-y-auto px-3 py-3">
				{agents.length === 0 ? (
					<div className="border border-dashed border-dark-800 px-4 py-5 text-sm text-dark-500">
						Waiting for agent list from the runtime.
					</div>
				) : (
					agents.map((agent) => (
						<AgentItem
							key={agent.agentId}
							agent={agent}
							isActive={agent.agentId === activeAgentId}
							isExpanded={expandedAgents[agent.agentId] ?? false}
							isDragging={draggingAgentId === agent.agentId}
							dropIndicator={
								dropIndicator?.agentId === agent.agentId
									? dropIndicator.position
									: null
							}
							onAttachRow={(element) => attachRow(agent.agentId, element)}
							activeSession={activeSessionByAgent[agent.agentId] ?? null}
							sessions={sessionsByAgent[agent.agentId] ?? []}
							onRowPointerDown={(event) => {
								if (event.button !== 0) {
									return;
								}

								const target = event.target as HTMLElement | null;
								if (
									target?.closest("[data-agent-row-ignore-drag='true']") !==
									null
								) {
									return;
								}

								suppressToggleRef.current = false;
								pendingDragRef.current = {
									agentId: agent.agentId,
									startX: event.clientX,
									startY: event.clientY,
								};
								dropIndicatorRef.current = null;
								setTrackingAgentId(agent.agentId);
								setDropIndicator(null);
							}}
							onToggle={() =>
								setExpandedAgents((current) => {
									if (suppressToggleRef.current) {
										suppressToggleRef.current = false;
										return current;
									}

									return {
										...current,
										[agent.agentId]: !(current[agent.agentId] ?? false),
									};
								})
							}
						/>
					))
				)}
			</div>

			<SidebarRuntimeStatus onRestart={() => sendCommand("/restart")} />
		</div>
	);
}
