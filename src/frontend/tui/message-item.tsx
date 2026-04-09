import { Box, Text } from "ink";
import { renderMarkdown } from "./markdown.ts";
import type { TuiMessage } from "./messages.ts";

interface MessageItemProps {
	message: TuiMessage;
	columns: number;
}

function wrapUserMessage(text: string, columns: number): string {
	const prefix = " ❯ ";
	const indent = "   "; // same width as prefix
	const contentWidth = columns - prefix.length;
	if (contentWidth <= 0) return `${prefix}${text}`.padEnd(columns);

	const words = text.split(" ");
	const lines: string[] = [];
	let current = "";

	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (next.length > contentWidth && current) {
			lines.push(current);
			current = word;
		} else {
			current = next;
		}
	}
	if (current) lines.push(current);

	return lines
		.map((line, i) => {
			const leader = i === 0 ? prefix : indent;
			return `${leader}${line}`.padEnd(columns);
		})
		.join("\n");
}

export function MessageItem({ message, columns }: MessageItemProps) {
	switch (message.role) {
		case "user":
			return (
				<Box marginTop={1}>
					<Text backgroundColor="#3b3b3b" color="white" bold>
						{wrapUserMessage(message.text, columns)}
					</Text>
				</Box>
			);
		case "assistant":
			return (
				<Box marginTop={1} paddingLeft={3} paddingRight={1}>
					<Text>{renderMarkdown(message.text, columns - 4)}</Text>
				</Box>
			);
		case "info":
			return (
				<Box paddingX={1}>
					<Text dimColor>{message.text}</Text>
				</Box>
			);
		case "error":
			return (
				<Box paddingX={1}>
					<Text>
						<Text color="red" bold>
							{"✗ "}
						</Text>
						<Text color="red">{message.text}</Text>
					</Text>
				</Box>
			);
	}
}
