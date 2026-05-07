import { useCallback, useEffect, useRef, useState } from "react";
import type {
	ServerEvent,
	SessionCursor,
	SkillInfo,
	WorkspaceFileEntry,
} from "../../../common/protocol.ts";
import type { AgentMenuData } from "../agents/types.ts";
import type { ConnectionStatus, RuntimeInfo } from "../chrome/status-bar.tsx";
import {
	applyOptimisticPromptState,
	queueOptimisticPromptState,
	requestTuiFiles,
	requestTuiSkillsOnce,
	sendTuiRuntimeCommand,
	sendTuiRuntimePrompt,
} from "../events/runtime-session-senders.ts";
import {
	projectRuntimeInfoEvent,
	projectRuntimeStatus,
} from "../events/runtime-status-projection.ts";
import { openTuiRuntimeSocket } from "../events/tui-socket-lifecycle.ts";
import { applySessionEventToMenuData } from "../sessions/state.ts";
import type { SessionMenuData } from "../sessions/types.ts";
import { applyAction } from "../transcript/reducer.ts";
import { mapEventToActions } from "../transcript/runtime-events.ts";
import { initialTuiState, type TuiState } from "../transcript/state.ts";

const WORKSPACE_FILES_REFRESH_INTERVAL_MS = 2000;

interface UseRuntimeSessionOptions {
	onTranscriptReset?: () => void;
}

function hasVisibleTuiWork(state: TuiState): boolean {
	return (
		state.running ||
		state.activePrompt !== undefined ||
		state.compacting ||
		state.heartbeatPending ||
		state.pendingPromptStart ||
		state.queuedPrompts.length > 0 ||
		state.streaming !== "" ||
		state.streamingThinking !== "" ||
		state.heartbeatStreaming !== "" ||
		state.heartbeatStreamingThinking !== ""
	);
}

function applyRuntimeRunningStatus(
	state: TuiState,
	running: boolean,
): TuiState {
	if (running) {
		return {
			...state,
			pendingPromptStart: false,
			running: true,
		};
	}

	if (state.pendingPromptStart && state.running) {
		return state;
	}

	return {
		...state,
		running: false,
	};
}

export function useRuntimeSession(
	url: string,
	agentName?: string,
	options: UseRuntimeSessionOptions = {},
) {
	const [agentMenuData, setAgentMenuData] = useState<AgentMenuData | null>(
		null,
	);
	const [tuiState, setTuiState] = useState(initialTuiState);
	const [status, setStatus] = useState<ConnectionStatus>("connecting");
	const [menuData, setMenuData] = useState<SessionMenuData | null>(null);
	const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo>({});
	const [skills, setSkills] = useState<SkillInfo[]>([]);
	const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileEntry[]>(
		[],
	);
	const skillsRequestedRef = useRef(false);
	const lastFilesRequestAtRef = useRef<number | null>(null);
	const agentNameRef = useRef<string | undefined>(undefined);
	const pendingSessionSearchQueryRef = useRef<string | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const onTranscriptResetRef = useRef(options.onTranscriptReset);

	useEffect(() => {
		onTranscriptResetRef.current = options.onTranscriptReset;
	}, [options.onTranscriptReset]);

	const pushLocalMessage = useCallback(
		(role: "error" | "info", text: string) => {
			setTuiState((previous) =>
				applyAction(previous, { type: "push", role, text }),
			);
		},
		[],
	);

	useEffect(() => {
		let cancelled = false;
		let retryTimer: ReturnType<typeof setTimeout> | null = null;

		function connect() {
			if (cancelled) {
				return;
			}

			const ws = openTuiRuntimeSocket({
				agentName,
				onClose: () => {
					if (cancelled) {
						return;
					}
					if (wsRef.current === ws) {
						wsRef.current = null;
					}
					skillsRequestedRef.current = false;
					lastFilesRequestAtRef.current = null;
					setSkills([]);
					setWorkspaceFiles([]);
					setTuiState((previous) => ({ ...previous, compacting: false }));
					setStatus("disconnected");
					retryTimer = setTimeout(connect, 3000);
				},
				onMessage: (event) => {
					handleRuntimeEvent(event);
				},
				onOpen: () => {
					skillsRequestedRef.current = false;
					lastFilesRequestAtRef.current = null;
					setStatus("connected");
				},
				url,
			});
			wsRef.current = ws;
			setStatus("connecting");
		}

		function handleRuntimeEvent(event: ServerEvent) {
			if (event.type === "skills_update") {
				setSkills(event.skills);
				return;
			}
			if (event.type === "workspace_files_update") {
				setWorkspaceFiles(event.entries);
				return;
			}
			if (event.type === "agent_menu") {
				setAgentMenuData({
					activeAgentId: event.activeAgentId,
					activeAgentName: event.activeAgentName,
					agents: event.agents,
				});
				return;
			}
			if (event.type === "agent_switched") {
				setAgentMenuData(null);
				setMenuData(null);
				pendingSessionSearchQueryRef.current = null;
				agentNameRef.current = event.name;
				setRuntimeInfo((previous) => projectRuntimeInfoEvent(previous, event));
			}
			if (
				event.type === "session_search_result" &&
				pendingSessionSearchQueryRef.current !== null &&
				event.query !== pendingSessionSearchQueryRef.current
			) {
				return;
			}
			if (event.type === "session_list" || event.type === "session_menu") {
				pendingSessionSearchQueryRef.current = null;
			}

			if (event.type === "runtime_status") {
				setRuntimeInfo((previous) => {
					const projection = projectRuntimeStatus({
						event,
						knownAgentName: agentNameRef.current,
						previous,
					});
					agentNameRef.current = projection.agentName;
					return projection.runtimeInfo;
				});
				setTuiState((previous) =>
					applyRuntimeRunningStatus(previous, event.running),
				);
			}
			if (event.type === "model_changed" || event.type === "effort_changed") {
				setRuntimeInfo((previous) => projectRuntimeInfoEvent(previous, event));
			}

			const actions = mapEventToActions(event);
			for (const action of actions) {
				if (action.type === "session_menu") {
					setMenuData(action.data);
					return;
				}

				setMenuData((previous) => applySessionEventToMenuData(previous, event));
				if (action.type === "clear") {
					onTranscriptResetRef.current?.();
				}
				setTuiState((previous) => applyAction(previous, action));
			}
		}

		connect();

		return () => {
			cancelled = true;
			if (retryTimer) {
				clearTimeout(retryTimer);
			}
			if (wsRef.current) {
				wsRef.current.close();
			}
		};
	}, [agentName, url]);

	const runCommand = useCallback(
		(command: string): boolean => {
			return sendTuiRuntimeCommand({
				command,
				pushLocalMessage,
				ws: wsRef.current,
			});
		},
		[pushLocalMessage],
	);

	const runPrompt = useCallback(
		(prompt: string): boolean => {
			if (
				!sendTuiRuntimePrompt({
					prompt,
					pushLocalMessage,
					ws: wsRef.current,
				})
			) {
				return false;
			}

			setTuiState((previous) => {
				if (hasVisibleTuiWork(previous)) {
					return queueOptimisticPromptState(previous, prompt);
				}

				return applyOptimisticPromptState(previous, prompt);
			});
			return true;
		},
		[pushLocalMessage],
	);

	const requestSkills = useCallback(() => {
		if (
			requestTuiSkillsOnce({
				alreadyRequested: skillsRequestedRef.current,
				ws: wsRef.current,
			})
		) {
			skillsRequestedRef.current = true;
			return true;
		}
		return false;
	}, []);

	const requestFiles = useCallback(() => {
		const now = Date.now();
		const lastRequestedAt = lastFilesRequestAtRef.current;
		if (
			lastRequestedAt !== null &&
			now - lastRequestedAt < WORKSPACE_FILES_REFRESH_INTERVAL_MS
		) {
			return false;
		}
		if (requestTuiFiles({ ws: wsRef.current })) {
			lastFilesRequestAtRef.current = now;
			return true;
		}
		return false;
	}, []);

	const dismissSessionMenu = useCallback(() => {
		setMenuData(null);
		pendingSessionSearchQueryRef.current = null;
	}, []);

	const dismissAgentMenu = useCallback(() => {
		setAgentMenuData(null);
	}, []);

	const loadMoreSessions = useCallback(
		(cursor: SessionCursor, query?: string) => {
			const trimmed = query?.trim();
			if (trimmed) {
				pendingSessionSearchQueryRef.current = trimmed;
				return runCommand(
					`/session search --limit 10 --cursor ${cursor.lastActive} ${cursor.sdkSessionId} -- ${trimmed}`,
				);
			}
			return runCommand(
				`/session list 10 ${cursor.lastActive} ${cursor.sdkSessionId}`,
			);
		},
		[runCommand],
	);

	const searchSessions = useCallback(
		(query: string) => {
			const trimmed = query.trim();
			if (!trimmed) {
				return false;
			}
			pendingSessionSearchQueryRef.current = trimmed;
			return runCommand(`/session search --limit 10 -- ${trimmed}`);
		},
		[runCommand],
	);

	const clearSessionSearch = useCallback(() => {
		pendingSessionSearchQueryRef.current = null;
		return runCommand("/session list 10");
	}, [runCommand]);

	return {
		agentMenuData,
		clearSessionSearch,
		dismissAgentMenu,
		dismissSessionMenu,
		loadMoreSessions,
		menuData,
		requestFiles,
		requestSkills,
		runCommand,
		runPrompt,
		runtimeInfo,
		skills,
		status,
		searchSessions,
		tuiState,
		workspaceFiles,
	};
}
