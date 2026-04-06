import { Box, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	parseMessage,
	type ServerEvent,
	serialize,
} from "../common/protocol.ts";

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
	const wsRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		const ws = new WebSocket(url);
		wsRef.current = ws;

		ws.onopen = () => setStatus("connected");
		ws.onclose = () => setStatus("disconnected");
		ws.onerror = () => setStatus("disconnected");

		ws.onmessage = (msg) => {
			const event = parseMessage(msg.data as string) as ServerEvent;
			switch (event.type) {
				case "session_cleared":
					setOutput("");
					break;
				case "user_prompt":
					setOutput((prev) => `${prev}[${event.source}] ${event.prompt}\n`);
					break;
				case "text":
					setOutput((prev) => prev + event.text);
					break;
				case "error":
					setOutput((prev) => `${prev}\n[error] ${event.message}`);
					break;
				case "done":
					setOutput((prev) => `${prev}\n`);
					break;
			}
		};

		return () => ws.close();
	}, [url]);

	const handleSubmit = useCallback((value: string) => {
		if (!value.trim() || !wsRef.current) return;
		if (value.trim() === "/new") {
			wsRef.current.send(serialize({ type: "command", command: "/new" }));
			setInput("");
			return;
		}
		setOutput((prev) => `${prev}> ${value}\n`);
		wsRef.current.send(serialize({ type: "prompt", prompt: value }));
		setInput("");
	}, []);

	useInput((_, key) => {
		if (key.escape) exit();
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
