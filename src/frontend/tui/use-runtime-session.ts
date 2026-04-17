import { useCallback, useEffect, useRef, useState } from "react";
import { canonicalizePromptSlashCommand } from "../../common/commands.ts";
import {
	extractError,
	parseMessage,
	type ServerEvent,
	type SkillInfo,
} from "../../common/protocol.ts";
import {
	isRuntimeSocketOpen,
	openRuntimeSocket,
	sendRequestSkills,
	sendRuntimeCommand,
	sendRuntimePrompt,
} from "../runtime-client/index.ts";
import type { AgentMenuData } from "./agents/types.ts";
import type { ConnectionStatus, RuntimeInfo } from "./chrome/status-bar.tsx";
import { applySessionEventToMenuData } from "./sessions/state.ts";
import type { SessionMenuData } from "./sessions/types.ts";
import { applyAction } from "./transcript/reducer.ts";
import { mapEventToActions } from "./transcript/runtime-events.ts";
import { initialTuiState } from "./transcript/state.ts";

export function useRuntimeSession(url: string, agentName?: string) {
	const [agentMenuData, setAgentMenuData] = useState<AgentMenuData | null>(
		null,
	);
	const [tuiState, setTuiState] = useState(initialTuiState);
	const [status, setStatus] = useState<ConnectionStatus>("connecting");
	const [menuData, setMenuData] = useState<SessionMenuData | null>(null);
	const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo>({});
	const [skills, setSkills] = useState<SkillInfo[]>([]);
	const skillsRequestedRef = useRef(false);
	const agentNameRef = useRef<string | undefined>(undefined);
	const wsRef = useRef<WebSocket | null>(null);

	const pushLocalMessage = useCallback(
		(role: "error" | "info", text: string) => {
			setTuiState((previous) =>
				applyAction(previous, { type: "push", role, text }),
			);
		},
		[],
	);

	const withOpenSocket = useCallback(
		(send: (ws: WebSocket) => void): boolean => {
			const ws = wsRef.current;
			if (!isRuntimeSocketOpen(ws)) {
				pushLocalMessage(
					"error",
					"Runtime disconnected. Waiting to reconnect.",
				);
				return false;
			}

			try {
				send(ws);
				return true;
			} catch (error) {
				pushLocalMessage("error", extractError(error));
				return false;
			}
		},
		[pushLocalMessage],
	);

	useEffect(() => {
		let cancelled = false;
		let retryTimer: ReturnType<typeof setTimeout> | null = null;

		function connect() {
			if (cancelled) {
				return;
			}

			const socket = openRuntimeSocket(url, "tui", agentName);
			const { ws } = socket;
			wsRef.current = ws;
			setStatus("connecting");
			void socket.ready.catch(() => {
				// onclose drives reconnect scheduling; suppress unhandled rejections.
			});

			ws.onopen = () => {
				skillsRequestedRef.current = false;
				setStatus("connected");
			};

			ws.onclose = () => {
				if (cancelled) {
					return;
				}
				if (wsRef.current === ws) {
					wsRef.current = null;
				}
				skillsRequestedRef.current = false;
				setSkills([]);
				setTuiState((previous) => ({ ...previous, compacting: false }));
				setStatus("disconnected");
				retryTimer = setTimeout(connect, 3000);
			};

			ws.onerror = () => {
				// onclose will fire after this; reconnect is handled there.
			};

			ws.onmessage = (message) => {
				const event = parseMessage(message.data as string) as ServerEvent;

				if (event.type === "skills_update") {
					setSkills(event.skills);
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
					agentNameRef.current = event.name;
					setRuntimeInfo((previous) => ({
						...previous,
						agentName: event.name,
					}));
				}

				if (event.type === "runtime_status") {
					if (event.agentName) {
						agentNameRef.current = event.agentName;
					}
					setRuntimeInfo((previous) => ({
						agentName:
							event.agentName ?? agentNameRef.current ?? previous.agentName,
						model: event.model,
						effort: event.effort,
						notice:
							event.notice?.kind === "restart_required"
								? "Restart required"
								: undefined,
						contextTokens: event.usage?.contextTokens,
						contextWindow: event.usage?.contextWindow,
						nextHeartbeatAt: event.nextHeartbeatAt,
						heartbeatDeferred: event.heartbeatDeferred,
					}));
					setTuiState((previous) => ({
						...previous,
						running: event.running,
					}));
				}
				if (event.type === "model_changed") {
					setRuntimeInfo((previous) => ({ ...previous, model: event.model }));
				} else if (event.type === "effort_changed") {
					setRuntimeInfo((previous) => ({ ...previous, effort: event.effort }));
				}

				const actions = mapEventToActions(event);
				for (const action of actions) {
					if (action.type === "session_menu") {
						setMenuData(action.data);
						return;
					}

					setMenuData((previous) =>
						applySessionEventToMenuData(previous, event),
					);
					setTuiState((previous) => applyAction(previous, action));
				}
			};
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
			return withOpenSocket((ws) => sendRuntimeCommand(ws, command));
		},
		[withOpenSocket],
	);

	const runPrompt = useCallback(
		(prompt: string): boolean => {
			if (!withOpenSocket((ws) => sendRuntimePrompt(ws, prompt))) {
				return false;
			}

			const compacting = canonicalizePromptSlashCommand(prompt) === "/compact";

			setTuiState((previous) =>
				applyAction(previous, {
					type: "push",
					role: "user",
					text: prompt,
				}),
			);
			if (compacting) {
				setTuiState((previous) =>
					applyAction(previous, {
						type: "start_compacting",
					}),
				);
			}
			setTuiState((previous) => ({
				...previous,
				running: true,
				compacting: compacting || previous.compacting,
			}));
			return true;
		},
		[withOpenSocket],
	);

	const requestSkills = useCallback(() => {
		if (skillsRequestedRef.current) {
			return false;
		}

		const ws = wsRef.current;
		if (!isRuntimeSocketOpen(ws)) {
			return false;
		}

		try {
			sendRequestSkills(ws);
			skillsRequestedRef.current = true;
			return true;
		} catch {
			return false;
		}
	}, []);

	const dismissSessionMenu = useCallback(() => {
		setMenuData(null);
	}, []);

	const dismissAgentMenu = useCallback(() => {
		setAgentMenuData(null);
	}, []);

	return {
		agentMenuData,
		dismissAgentMenu,
		dismissSessionMenu,
		menuData,
		requestSkills,
		runCommand,
		runPrompt,
		runtimeInfo,
		skills,
		status,
		tuiState,
	};
}
