import { Box, render, Text, useApp, useStdout } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { isRuntimeCommand } from "../common/commands.ts";
import {
	extractError,
	parseMessage,
	type ServerEvent,
} from "../common/protocol.ts";
import {
	isRuntimeSocketOpen,
	openRuntimeSocket,
	sendRuntimeCommand,
	sendRuntimePrompt,
} from "./runtime-client/index.ts";
import { applyAction, mapEventToAction } from "./tui/event-reducer.ts";
import { HeaderBar } from "./tui/header-bar.tsx";
import {
	applyCollapsedPasteKeypress,
	createPasteAwareDraft,
} from "./tui/large-paste.ts";
import { MessageList } from "./tui/message-list.tsx";
import { initialTuiState, type SessionMenuData } from "./tui/messages.ts";
import {
	formatSessionMenuItem,
	type SessionMenuChoice,
	sessionMenuChoices,
} from "./tui/session-menu.ts";
import {
	applySessionEventToMenuData,
	shouldEnableGlobalStopShortcut,
} from "./tui/session-state.ts";
import {
	type ConnectionStatus,
	type RuntimeInfo,
	StatusBar,
} from "./tui/status-bar.tsx";
import { TextArea } from "./tui/text-area.tsx";
import { useTerminalInput, useTextAreaInput } from "./tui/text-area-input.ts";

interface SessionMenuProps {
	choices: SessionMenuChoice[];
	onSelect: (choice: SessionMenuChoice) => void;
	onDelete: (choice: SessionMenuChoice) => void;
	onRename: (choice: SessionMenuChoice, title: string) => void;
	onDismiss: () => void;
}

function SessionMenu({
	choices,
	onSelect,
	onDelete,
	onRename,
	onDismiss,
}: SessionMenuProps) {
	const [cursor, setCursor] = useState(0);
	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState("");
	const { stdout } = useStdout();
	const columns = stdout?.columns ?? 80;
	const labelWidth = columns - 4;

	// Clamp cursor when list shrinks after delete
	useEffect(() => {
		if (cursor >= choices.length && choices.length > 0) {
			setCursor(choices.length - 1);
		}
	}, [choices.length, cursor]);

	useTerminalInput(({ input, key }) => {
		if (choices.length === 0) {
			if (key.escape) {
				onDismiss();
			}
			return;
		}
		if (key.escape) {
			onDismiss();
			return;
		}
		if (key.return) {
			const choice = choices[cursor];
			if (choice) onSelect(choice);
			return;
		}
		if (input === "d") {
			const choice = choices[cursor];
			if (choice) onDelete(choice);
			return;
		}
		if (input === "r") {
			const choice = choices[cursor];
			if (choice) {
				setRenameValue(choice.title);
				setRenaming(true);
			}
			return;
		}
		if (key.upArrow) {
			setCursor((prev) => (prev > 0 ? prev - 1 : choices.length - 1));
		}
		if (key.downArrow) {
			setCursor((prev) => (prev < choices.length - 1 ? prev + 1 : 0));
		}
	}, !renaming);

	const handleRenameSubmit = useCallback(
		(value: string) => {
			const choice = choices[cursor];
			const trimmed = value.trim();
			if (choice && trimmed) {
				onRename(choice, trimmed);
			}
			setRenaming(false);
		},
		[choices, cursor, onRename],
	);

	const handleRenameCancel = useCallback(() => {
		setRenaming(false);
	}, []);

	return (
		<Box flexDirection="column">
			<Text bold>Sessions</Text>
			{choices.map((choice, i) => {
				const pointer = i === cursor ? "▸ " : "  ";
				if (renaming && i === cursor) {
					return (
						<Box key={choice.sdkSessionId}>
							<Text color="cyan">{pointer}</Text>
							<RenameInput
								value={renameValue}
								onChange={setRenameValue}
								onSubmit={handleRenameSubmit}
								onCancel={handleRenameCancel}
							/>
						</Box>
					);
				}
				const label = formatSessionMenuItem(choice, labelWidth);
				return (
					<Text
						key={choice.sdkSessionId}
						color={i === cursor ? "cyan" : undefined}
					>
						{pointer}
						{label}
					</Text>
				);
			})}
			<Text dimColor>
				{renaming
					? "Enter confirm · Esc cancel"
					: "Enter select · d delete · r rename · Esc dismiss"}
			</Text>
		</Box>
	);
}

function RenameInput({
	value,
	onChange,
	onSubmit,
	onCancel,
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: (value: string) => void;
	onCancel: () => void;
}) {
	useTerminalInput(({ key }) => {
		if (key.escape) onCancel();
	}, true);

	return (
		<TextArea
			value={value}
			onChange={onChange}
			onSubmit={onSubmit}
			rows={1}
			maxRows={1}
		/>
	);
}

interface TuiProps {
	url: string;
}

function useTerminalSize(): { columns: number; rows: number } {
	const { stdout } = useStdout();
	const [size, setSize] = useState({
		columns: stdout?.columns ?? 80,
		rows: stdout?.rows ?? 24,
	});

	useEffect(() => {
		const onResize = () =>
			setSize({
				columns: stdout?.columns ?? 80,
				rows: stdout?.rows ?? 24,
			});
		stdout?.on("resize", onResize);
		return () => {
			stdout?.off("resize", onResize);
		};
	}, [stdout]);

	return size;
}

function Tui({ url }: TuiProps) {
	const { exit } = useApp();
	const { columns, rows: termRows } = useTerminalSize();
	const [composerDraft, setComposerDraft] = useState(() =>
		createPasteAwareDraft(),
	);
	const input = composerDraft.value;
	const draftCursor = composerDraft.cursor;
	const ignoreTextAreaChange = useCallback((_value: string) => {}, []);
	const ignoreTextAreaSubmit = useCallback((_value: string) => {}, []);
	const resetComposer = useCallback(() => {
		setComposerDraft(createPasteAwareDraft());
	}, []);
	const [tuiState, setTuiState] = useState(initialTuiState);
	const [status, setStatus] = useState<ConnectionStatus>("connecting");
	const [menuData, setMenuData] = useState<SessionMenuData | null>(null);
	const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo>({});
	const wsRef = useRef<WebSocket | null>(null);
	const pushLocalMessage = useCallback(
		(role: "error" | "info", text: string) => {
			setTuiState((prev) => applyAction(prev, { type: "push", role, text }));
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
			if (cancelled) return;
			const socket = openRuntimeSocket(url, "tui");
			const { ws } = socket;
			wsRef.current = ws;
			setStatus("connecting");
			void socket.ready.catch(() => {
				// onclose drives reconnect scheduling; suppress unhandled rejections.
			});

			ws.onopen = () => setStatus("connected");

			ws.onclose = () => {
				if (cancelled) return;
				setStatus("disconnected");
				retryTimer = setTimeout(connect, 3000);
			};

			ws.onerror = () => {
				// onclose will fire after this — reconnect handled there
			};

			ws.onmessage = (msg) => {
				const event = parseMessage(msg.data as string) as ServerEvent;

				if (event.type === "runtime_status") {
					setRuntimeInfo({
						model: event.model,
						effort: event.effort,
						contextPercentage: event.usage?.percentage,
					});
					return;
				}
				if (event.type === "model_changed") {
					setRuntimeInfo((prev) => ({ ...prev, model: event.model }));
				} else if (event.type === "effort_changed") {
					setRuntimeInfo((prev) => ({ ...prev, effort: event.effort }));
				}

				const action = mapEventToAction(event);

				if (action.type === "session_menu") {
					setMenuData(action.data);
					return;
				}

				setMenuData((prev) => applySessionEventToMenuData(prev, event));
				setTuiState((prev) => applyAction(prev, action));
			};
		}

		connect();

		return () => {
			cancelled = true;
			if (retryTimer) clearTimeout(retryTimer);
			if (wsRef.current) wsRef.current.close();
		};
	}, [url]);

	const handleSubmit = useCallback(
		(value: string) => {
			const text = value;
			if (!text.trim()) return;
			const trimmed = text.trim();
			if (trimmed === "/exit") {
				exit();
				return;
			}
			if (isRuntimeCommand(trimmed)) {
				if (!withOpenSocket((ws) => sendRuntimeCommand(ws, trimmed))) {
					return;
				}
				resetComposer();
				return;
			}
			if (!withOpenSocket((ws) => sendRuntimePrompt(ws, text))) {
				return;
			}
			setTuiState((prev) =>
				applyAction(prev, {
					type: "push",
					role: "user",
					text,
				}),
			);
			setTuiState((prev) => ({
				...prev,
				running: true,
			}));
			resetComposer();
		},
		[exit, resetComposer, withOpenSocket],
	);

	const handleMenuSelect = useCallback(
		(choice: SessionMenuChoice) => {
			if (
				!withOpenSocket((ws) =>
					sendRuntimeCommand(ws, `/session ${choice.sdkSessionId}`),
				)
			) {
				return;
			}
			setMenuData(null);
		},
		[withOpenSocket],
	);

	const handleMenuDelete = useCallback(
		(choice: SessionMenuChoice) => {
			withOpenSocket((ws) =>
				sendRuntimeCommand(ws, `/session delete ${choice.sdkSessionId}`),
			);
		},
		[withOpenSocket],
	);

	const handleMenuRename = useCallback(
		(choice: SessionMenuChoice, title: string) => {
			withOpenSocket((ws) =>
				sendRuntimeCommand(
					ws,
					`/session rename ${choice.sdkSessionId} ${title}`,
				),
			);
		},
		[withOpenSocket],
	);

	const handleMenuDismiss = useCallback(() => {
		setMenuData(null);
	}, []);

	const inputActive = !tuiState.running && menuData === null;

	useTextAreaInput(({ input: inputKey, key, sequence }) => {
		const action = applyCollapsedPasteKeypress(
			composerDraft,
			inputKey,
			key,
			sequence,
		);
		if (action.type === "ignore") {
			return;
		}
		if (action.type === "clear") {
			resetComposer();
			return;
		}
		if (action.type === "submit") {
			handleSubmit(action.value ?? composerDraft.value);
			return;
		}
		if (action.type === "update" && action.draft) {
			setComposerDraft(action.draft);
		}
	}, inputActive);

	useTerminalInput(
		({ key }) => {
			if (key.escape) {
				withOpenSocket((ws) => sendRuntimeCommand(ws, "/stop"));
			}
		},
		shouldEnableGlobalStopShortcut(tuiState.running, menuData !== null),
	);

	const choices = menuData
		? sessionMenuChoices(menuData.sessions, menuData.activeSessionId)
		: null;

	const divider = "─".repeat(columns);

	return (
		<Box flexDirection="column" paddingY={1}>
			<Box paddingX={1}>
				<HeaderBar />
			</Box>
			<Text color="#f97316">{"═".repeat(columns)}</Text>
			<Box marginTop={1} marginBottom={1} flexGrow={1} flexDirection="column">
				<MessageList
					messages={tuiState.messages}
					streaming={tuiState.streaming}
					running={tuiState.running}
					columns={columns}
				/>
			</Box>
			{choices ? (
				<Box paddingX={1}>
					<SessionMenu
						choices={choices}
						onSelect={handleMenuSelect}
						onDelete={handleMenuDelete}
						onRename={handleMenuRename}
						onDismiss={handleMenuDismiss}
					/>
				</Box>
			) : (
				<Box flexDirection="column">
					<Text dimColor>{divider}</Text>
					<Box paddingX={1} alignItems="flex-start">
						<Text bold color="cyan">
							{"❯ "}
						</Text>
						<Box flexGrow={1} flexDirection="column">
							<TextArea
								key="draft-editor"
								value={input}
								onChange={ignoreTextAreaChange}
								onSubmit={ignoreTextAreaSubmit}
								cursor={draftCursor}
								focus={inputActive}
								captureInput={false}
								rows={1}
								maxRows={Math.max(5, Math.floor(termRows / 3))}
							/>
						</Box>
					</Box>
					<Text dimColor>{divider}</Text>
				</Box>
			)}
			<Box paddingX={1}>
				<StatusBar status={status} info={runtimeInfo} />
			</Box>
		</Box>
	);
}

export function startTui(url: string) {
	return render(<Tui url={url} />);
}
