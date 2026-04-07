import { Box, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useCallback, useEffect, useRef, useState } from "react";
import { isRuntimeCommand } from "../common/commands.ts";
import { parseMessage, type ServerEvent } from "../common/protocol.ts";
import {
	openRuntimeSocket,
	sendRuntimeCommand,
	sendRuntimePrompt,
} from "./runtime-client/index.ts";
import { getTuiEventUpdate } from "./tui/output.ts";

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
	const wsRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		const socket = openRuntimeSocket(url);
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

	useInput((_, key) => {
		if (key.escape && running && wsRef.current) {
			sendRuntimeCommand(wsRef.current, "/stop");
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold>misanthropic</Text>
				<Text> — </Text>
				<Text color={status === "connected" ? "green" : "red"}>{status}</Text>
			</Box>
			<Box flexGrow={1}>
				<Text>{output}</Text>
			</Box>
			<Box>
				<Text bold color="cyan">
					{"❯ "}
				</Text>
				<TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
			</Box>
		</Box>
	);
}

export function startTui(url: string) {
	return render(<Tui url={url} />);
}
