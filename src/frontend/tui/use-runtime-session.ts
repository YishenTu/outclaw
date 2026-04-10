import { useCallback, useEffect, useRef, useState } from "react";
import {
	extractError,
	parseMessage,
	type ServerEvent,
} from "../../common/protocol.ts";
import {
	isRuntimeSocketOpen,
	openRuntimeSocket,
	sendRuntimeCommand,
	sendRuntimePrompt,
} from "../runtime-client/index.ts";
import type { ConnectionStatus, RuntimeInfo } from "./chrome/status-bar.tsx";
import { applySessionEventToMenuData } from "./sessions/state.ts";
import type { SessionMenuData } from "./sessions/types.ts";
import { applyAction } from "./transcript/reducer.ts";
import { mapEventToActions } from "./transcript/runtime-events.ts";
import { initialTuiState } from "./transcript/state.ts";

export function useRuntimeSession(url: string) {
	const [tuiState, setTuiState] = useState(initialTuiState);
	const [status, setStatus] = useState<ConnectionStatus>("connecting");
	const [menuData, setMenuData] = useState<SessionMenuData | null>(null);
	const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo>({});
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

			const socket = openRuntimeSocket(url, "tui");
			const { ws } = socket;
			wsRef.current = ws;
			setStatus("connecting");
			void socket.ready.catch(() => {
				// onclose drives reconnect scheduling; suppress unhandled rejections.
			});

			ws.onopen = () => {
				setStatus("connected");
			};

			ws.onclose = () => {
				if (cancelled) {
					return;
				}
				setStatus("disconnected");
				retryTimer = setTimeout(connect, 3000);
			};

			ws.onerror = () => {
				// onclose will fire after this; reconnect is handled there.
			};

			ws.onmessage = (message) => {
				const event = parseMessage(message.data as string) as ServerEvent;

				if (event.type === "runtime_status") {
					setRuntimeInfo({
						model: event.model,
						effort: event.effort,
						contextPercentage: event.usage?.percentage ?? 0,
					});
					return;
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
	}, [url]);

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

			setTuiState((previous) =>
				applyAction(previous, {
					type: "push",
					role: "user",
					text: prompt,
				}),
			);
			setTuiState((previous) => ({
				...previous,
				running: true,
			}));
			return true;
		},
		[withOpenSocket],
	);

	const dismissSessionMenu = useCallback(() => {
		setMenuData(null);
	}, []);

	return {
		dismissSessionMenu,
		menuData,
		runCommand,
		runPrompt,
		runtimeInfo,
		status,
		tuiState,
	};
}
