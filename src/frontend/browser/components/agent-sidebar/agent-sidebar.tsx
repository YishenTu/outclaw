import { PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	BrowserSessionSummary,
	SessionCursor,
} from "../../../../common/protocol.ts";
import { ChatCodePillSwitcher } from "../../coding/chat-code-pill-switcher.tsx";
import { useCodingStore } from "../../coding/coding-store.ts";
import { requestConfigRestart } from "../../commands/config-save-restart.ts";
import { useWs } from "../../contexts/websocket-context.tsx";
import {
	fetchAgentSessions,
	fetchConfigFile,
	updateConfigFile,
} from "../../lib/api.ts";
import type { AgentReorderPosition } from "../../stores/agents.ts";
import { useAgentsStore } from "../../stores/agents.ts";
import type { SessionEntry } from "../../stores/sessions.ts";
import { useSessionsStore } from "../../stores/sessions.ts";
import { AgentItem } from "./agent-item.tsx";
import {
	applyConfigEntryEdits,
	type ConfigDocument,
	type ConfigEntry,
	parseConfigDocument,
	parseConfigEntries,
} from "./config-editor.ts";
import { ConfigModalContent } from "./config-panel.tsx";
import {
	type AgentDropIndicator,
	type AgentRowBounds,
	resolveAgentDropIndicator,
} from "./resolve-agent-drop-indicator.ts";
import { SidebarNotifications } from "./sidebar-notifications.tsx";
import { SidebarRuntimeStatus } from "./sidebar-runtime-status.tsx";

interface AgentSidebarProps {
	onCollapse?: () => void;
}

export function AgentSidebar({ onCollapse }: AgentSidebarProps) {
	const { sendCommand } = useWs();
	const setAppMode = useCodingStore((state) => state.setAppMode);
	const dragThreshold = 4;
	const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>(
		{},
	);
	const [trackingAgentId, setTrackingAgentId] = useState<string | null>(null);
	const [draggingAgentId, setDraggingAgentId] = useState<string | null>(null);
	const [configOpen, setConfigOpen] = useState(false);
	const [configLoading, setConfigLoading] = useState(false);
	const [configSaving, setConfigSaving] = useState(false);
	const [configError, setConfigError] = useState<string | null>(null);
	const [configErrorMode, setConfigErrorMode] = useState<"load" | "save">(
		"load",
	);
	const [configDocument, setConfigDocument] = useState<ConfigDocument | null>(
		null,
	);
	const [configEntries, setConfigEntries] = useState<ConfigEntry[]>([]);
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
	const nextCursorByAgent = useSessionsStore(
		(state) => state.nextCursorByAgent,
	);
	const searchByAgent = useSessionsStore((state) => state.searchByAgent);
	const activeSessionByAgent = useSessionsStore(
		(state) => state.activeSessionByAgent,
	);
	const appendSessions = useSessionsStore((state) => state.appendSessions);
	const setSearchResults = useSessionsStore((state) => state.setSearchResults);
	const appendSearchResults = useSessionsStore(
		(state) => state.appendSearchResults,
	);
	const clearSearch = useSessionsStore((state) => state.clearSearch);
	const loadingMoreAgentsRef = useRef(new Set<string>());
	const loadingMoreSearchRef = useRef(new Set<string>());
	const pendingSearchByAgentRef = useRef<Record<string, string>>({});

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

	const loadMoreSessions = useCallback(
		async (agentId: string) => {
			const cursor = nextCursorByAgent[agentId];
			if (!cursor || loadingMoreAgentsRef.current.has(agentId)) {
				return;
			}
			loadingMoreAgentsRef.current.add(agentId);
			try {
				const page = await fetchAgentSessions(agentId, {
					cursor,
					limit: 10,
				});
				appendSessions(
					agentId,
					page.sessions.map((session) => toSessionEntry(agentId, session)),
					page.nextCursor,
				);
			} catch (error) {
				console.error(error);
			} finally {
				loadingMoreAgentsRef.current.delete(agentId);
			}
		},
		[appendSessions, nextCursorByAgent],
	);

	const searchSessions = useCallback(
		async (agentId: string, query: string, cursor?: SessionCursor) => {
			const trimmed = query.trim();
			if (!trimmed) {
				clearSearch(agentId);
				return;
			}
			const loadingKey = `${agentId}\u0000${trimmed}`;
			if (cursor && loadingMoreSearchRef.current.has(loadingKey)) {
				return;
			}
			if (cursor) {
				loadingMoreSearchRef.current.add(loadingKey);
			}
			pendingSearchByAgentRef.current[agentId] = trimmed;
			try {
				const page = await fetchAgentSessions(agentId, {
					cursor,
					limit: 10,
					query: trimmed,
				});
				if (pendingSearchByAgentRef.current[agentId] !== trimmed) {
					return;
				}
				const sessions = page.sessions.map((session) =>
					toSessionEntry(agentId, session),
				);
				const resolvedQuery = page.query ?? trimmed;
				if (cursor) {
					appendSearchResults(
						agentId,
						resolvedQuery,
						sessions,
						page.nextCursor,
					);
				} else {
					setSearchResults(agentId, resolvedQuery, sessions, page.nextCursor);
				}
			} catch (error) {
				console.error(error);
			} finally {
				if (cursor) {
					loadingMoreSearchRef.current.delete(loadingKey);
				}
			}
		},
		[appendSearchResults, clearSearch, setSearchResults],
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

	useEffect(() => {
		if (!configOpen) {
			return;
		}

		let cancelled = false;
		setConfigLoading(true);
		setConfigError(null);
		setConfigErrorMode("load");

		void fetchConfigFile()
			.then((configFile) => {
				if (configFile.kind !== "text" || configFile.content === undefined) {
					throw new Error("Config file is not readable text");
				}
				const document = parseConfigDocument(configFile.content);
				const agentNamesById = Object.fromEntries(
					agents.map((agent) => [agent.agentId, agent.name] as const),
				);
				const parsed = parseConfigEntries(document, {
					agentNamesById,
					schema: configFile.schema,
				});
				if (!cancelled) {
					setConfigDocument(document);
					setConfigEntries(parsed);
					setConfigError(null);
					setConfigErrorMode("load");
				}
			})
			.catch((error) => {
				if (!cancelled) {
					setConfigDocument(null);
					setConfigEntries([]);
					setConfigErrorMode("load");
					setConfigError(
						error instanceof Error ? error.message : "Failed to load config",
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setConfigLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [agents, configOpen]);

	const handleConfigEntryChange = useCallback((item: string, value: string) => {
		setConfigEntries((current) =>
			current.map((entry) =>
				entry.item === item ? { ...entry, value } : entry,
			),
		);
	}, []);

	const handleConfigSave = useCallback(() => {
		if (!configDocument) {
			setConfigErrorMode("save");
			setConfigError("Config is not loaded");
			return;
		}

		let nextDocument: ConfigDocument;
		try {
			nextDocument = applyConfigEntryEdits(configDocument, configEntries);
		} catch (error) {
			setConfigErrorMode("save");
			setConfigError(
				error instanceof Error ? error.message : "Failed to update config",
			);
			return;
		}

		setConfigSaving(true);
		setConfigError(null);
		setConfigErrorMode("save");
		void updateConfigFile(nextDocument)
			.then((configFile) => {
				if (configFile.kind !== "text" || configFile.content === undefined) {
					throw new Error("Config file is not readable text");
				}
				const document = parseConfigDocument(configFile.content);
				const agentNamesById = Object.fromEntries(
					agents.map((agent) => [agent.agentId, agent.name] as const),
				);
				setConfigDocument(document);
				setConfigEntries(
					parseConfigEntries(document, {
						agentNamesById,
						schema: configFile.schema,
					}),
				);
				const restartError = requestConfigRestart(sendCommand);
				if (restartError) {
					setConfigErrorMode("save");
					setConfigError(restartError);
					return;
				}

				setConfigOpen(false);
				setConfigError(null);
				setConfigErrorMode("load");
			})
			.catch((error) => {
				setConfigErrorMode("save");
				setConfigError(
					error instanceof Error ? error.message : "Failed to save config",
				);
			})
			.finally(() => {
				setConfigSaving(false);
			});
	}, [agents, configDocument, configEntries, sendCommand]);

	return (
		<div className="relative flex h-full flex-col bg-dark-950">
			{configOpen ? (
				<ConfigModalContent
					entries={configEntries}
					error={configError}
					errorMode={configErrorMode}
					isLoading={configLoading}
					isSaving={configSaving}
					onClose={() => setConfigOpen(false)}
					onEntryChange={handleConfigEntryChange}
					onSave={handleConfigSave}
				/>
			) : null}
			<div className="relative flex h-12 items-center justify-center border-b border-dark-800 px-3">
				<img
					src="/Sidebar%20Banner.png"
					alt="OUTCLAW"
					className="h-7 w-auto shrink-0 -translate-x-3"
				/>
				{onCollapse && (
					<button
						type="button"
						onClick={onCollapse}
						className="absolute right-3 flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
						aria-label="Collapse left sidebar"
					>
						<PanelLeftOpen size={15} />
					</button>
				)}
			</div>

			<div className="flex h-8 shrink-0 items-center border-b border-dark-800 px-3">
				<ChatCodePillSwitcher
					active="chat"
					onSelect={(mode) => {
						if (mode === "code") {
							setAppMode("code");
						}
					}}
				/>
			</div>

			<div className="scrollbar-none flex-1 overflow-y-auto px-3 py-3">
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
							nextCursor={nextCursorByAgent[agent.agentId]}
							searchState={searchByAgent[agent.agentId]}
							sessions={sessionsByAgent[agent.agentId] ?? []}
							onClearSearch={() => {
								delete pendingSearchByAgentRef.current[agent.agentId];
								clearSearch(agent.agentId);
							}}
							onLoadMore={() => loadMoreSessions(agent.agentId)}
							onLoadMoreSearch={(query) =>
								searchSessions(
									agent.agentId,
									query,
									searchByAgent[agent.agentId]?.nextCursor,
								)
							}
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
							onSearch={(query) => searchSessions(agent.agentId, query)}
						/>
					))
				)}
			</div>

			<SidebarNotifications />
			<SidebarRuntimeStatus
				configOpen={configOpen}
				onToggleConfig={() => setConfigOpen((current) => !current)}
				onRestart={() => sendCommand("/restart")}
			/>
		</div>
	);
}

function toSessionEntry(
	agentId: string,
	session: BrowserSessionSummary,
): SessionEntry {
	return {
		agentId,
		providerId: session.providerId,
		sdkSessionId: session.sdkSessionId,
		title: session.title,
		model: session.model,
		lastActive: session.lastActive,
	};
}
