import { Box, Text } from "ink";
import { memo } from "react";
import { theme } from "../chrome/theme.ts";
import { renderMarkdown } from "./markdown.ts";
import type { TuiMessage } from "./state.ts";

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

export const MessageItem = memo(function MessageItem({
	message,
	columns,
}: MessageItemProps) {
	switch (message.role) {
		case "user":
			return (
				<Box marginTop={1}>
					<Text backgroundColor={theme.userMsgBg} color={theme.userMsgFg} bold>
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
		case "status": {
			const w = columns - 4;
			const [title, ...body] = message.text.split("\n");
			// Labels are padded to equal width; the real separator "  " starts
			// at the longest label's length — which equals the max indexOf("  ").
			const sep = Math.max(...body.map((l) => l.indexOf("  ")));
			const valStart = sep + 2;
			return (
				<Box marginTop={1} paddingLeft={3} paddingRight={1}>
					<Text backgroundColor={theme.statusBg}>
						<Text bold color={theme.accent}>
							{` ${title}`.padEnd(w)}
						</Text>
						{body.map((line) => (
							<>
								{"\n"}
								<Text bold>{` ${line.slice(0, valStart)}`}</Text>
								{line.slice(valStart).padEnd(w - valStart - 1)}
							</>
						))}
					</Text>
				</Box>
			);
		}
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
						<Text color={theme.error} bold>
							{"✗ "}
						</Text>
						<Text color={theme.error}>{message.text}</Text>
					</Text>
				</Box>
			);
	}
});
