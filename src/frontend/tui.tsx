import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import { useCallback, useEffect, useRef, useState } from "react";
import { isRuntimeCommand } from "../common/commands.ts";
import { parseMessage, type ServerEvent } from "../common/protocol.ts";
import {
	openRuntimeSocket,
	sendRuntimeCommand,
	sendRuntimePrompt,
} from "./runtime-client/index.ts";
import { getTuiEventUpdate, type SessionMenuData } from "./tui/output.ts";
import {
	formatSessionMenuItem,
	type SessionMenuChoice,
	sessionMenuChoices,
} from "./tui/session-menu.ts";
import {
	applySessionEventToMenuData,
	shouldEnableGlobalStopShortcut,
} from "./tui/session-state.ts";

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
	const labelWidth = columns - 4; // 2 pointer + 2 box padding

	useInput(
		(input, key) => {
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
		},
		{ isActive: !renaming },
	);

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
	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
	});

	return <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />;
}

interface TuiProps {
	url: string;
}

function Tui({ url }: TuiProps) {
	const { exit } = useApp();
	const [input, setInput] = useState("");
	const [output, setOutput] = useState("");
	const [status, setStatus] = useState<
		"connecting" | "connected" | "disconnected"
	>("connecting");
	const [running, setRunning] = useState(false);
	const [menuData, setMenuData] = useState<SessionMenuData | null>(null);
	const wsRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		const socket = openRuntimeSocket(url, "tui");
		const { ws } = socket;
		wsRef.current = ws;

		ws.onopen = () => setStatus("connected");
		ws.onclose = () => setStatus("disconnected");
		ws.onerror = () => setStatus("disconnected");

		ws.onmessage = (msg) => {
			const event = parseMessage(msg.data as string) as ServerEvent;
			const update = getTuiEventUpdate(event);
			if (!update) {
				return;
			}
			if (update.sessionMenu) {
				setMenuData(update.sessionMenu);
				return;
			}
			setMenuData((prev) => applySessionEventToMenuData(prev, event));
			if (update.replace !== undefined) {
				setOutput(update.replace);
			}
			if (update.append) {
				setOutput((prev) => `${prev}${update.append}`);
			}
			if (update.running !== undefined) {
				setRunning(update.running);
			}
		};

		return () => socket.close();
	}, [url]);

	const handleSubmit = useCallback(
		(value: string) => {
			if (!value.trim() || !wsRef.current) return;
			const trimmed = value.trim();
			if (trimmed === "/exit") {
				exit();
				return;
			}
			if (isRuntimeCommand(trimmed)) {
				sendRuntimeCommand(wsRef.current, trimmed);
				setInput("");
				return;
			}
			setOutput((prev) => `${prev}> ${value}\n`);
			setRunning(true);
			sendRuntimePrompt(wsRef.current, value);
			setInput("");
		},
		[exit],
	);

	const handleMenuSelect = useCallback((choice: SessionMenuChoice) => {
		if (!wsRef.current) return;
		sendRuntimeCommand(wsRef.current, `/session ${choice.sdkSessionId}`);
		setMenuData(null);
	}, []);

	const handleMenuDelete = useCallback((choice: SessionMenuChoice) => {
		if (!wsRef.current) return;
		sendRuntimeCommand(wsRef.current, `/session delete ${choice.sdkSessionId}`);
	}, []);

	const handleMenuRename = useCallback(
		(choice: SessionMenuChoice, title: string) => {
			if (!wsRef.current) return;
			sendRuntimeCommand(
				wsRef.current,
				`/session rename ${choice.sdkSessionId} ${title}`,
			);
		},
		[],
	);

	const handleMenuDismiss = useCallback(() => {
		setMenuData(null);
	}, []);

	useInput(
		(_, key) => {
			if (key.escape && wsRef.current) {
				sendRuntimeCommand(wsRef.current, "/stop");
			}
		},
		{
			isActive: shouldEnableGlobalStopShortcut(running, menuData !== null),
		},
	);

	const choices = menuData
		? sessionMenuChoices(menuData.sessions, menuData.activeSessionId)
		: null;

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold>outclaw</Text>
				<Text> — </Text>
				<Text color={status === "connected" ? "green" : "red"}>{status}</Text>
			</Box>
			<Box flexGrow={1}>
				<Text>{output}</Text>
			</Box>
			{choices ? (
				<SessionMenu
					choices={choices}
					onSelect={handleMenuSelect}
					onDelete={handleMenuDelete}
					onRename={handleMenuRename}
					onDismiss={handleMenuDismiss}
				/>
			) : (
				<Box>
					<Text bold color="cyan">
						{"❯ "}
					</Text>
					<TextInput
						value={input}
						onChange={setInput}
						onSubmit={handleSubmit}
					/>
				</Box>
			)}
		</Box>
	);
}

export function startTui(url: string) {
	return render(<Tui url={url} />);
}
