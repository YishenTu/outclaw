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
				case "session_switched":
					setOutput("");
					break;
				case "history_replay": {
					const history = event.messages
						.map((m: { role: string; content: string }) =>
							m.role === "user" ? `> ${m.content}\n` : `${m.content}\n`,
						)
						.join("\n");
					setOutput(history);
					break;
				}
				case "model_changed":
					setOutput((prev) => `${prev}[model] ${event.model}\n`);
					break;
				case "runtime_status": {
					const u = event.usage as
						| {
								contextTokens: number;
								contextWindow: number;
								percentage: number;
						  }
						| undefined;
					const ctx = u
						? `${u.contextTokens.toLocaleString()}/${u.contextWindow.toLocaleString()} tokens (${u.percentage}%)`
						: "n/a";
					setOutput(
						(prev) =>
							`${prev}[status] model=${event.model} effort=${event.effort} session=${event.sessionId ?? "none"} context=${ctx}\n`,
					);
					break;
				}
				case "effort_changed":
					setOutput((prev) => `${prev}[effort] ${event.effort}\n`);
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
		const trimmed = value.trim();
		const isCommand =
			trimmed === "/new" ||
			trimmed === "/status" ||
			trimmed.startsWith("/model") ||
			trimmed.startsWith("/thinking") ||
			trimmed.startsWith("/session") ||
			["/opus", "/sonnet", "/haiku"].includes(trimmed);
		if (isCommand) {
			wsRef.current.send(serialize({ type: "command", command: trimmed }));
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
