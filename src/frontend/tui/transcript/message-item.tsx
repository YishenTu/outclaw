import { Box, Text } from "ink";
import { memo } from "react";
import { theme } from "../chrome/theme.ts";
import { wrapBubble } from "./bubble.ts";
import { renderMarkdown } from "./markdown.ts";
import type { TuiMessage } from "./state.ts";

interface MessageItemProps {
	message: TuiMessage;
	columns: number;
}

export const MessageItem = memo(function MessageItem({
	message,
	columns,
}: MessageItemProps) {
	switch (message.role) {
		case "user":
			return (
				<Box marginTop={1} flexDirection="column">
					{message.replyText ? (
						<>
							<Text
								backgroundColor={theme.replyMsgBg}
								color={theme.replyMsgFg}
								bold
							>
								{wrapBubble("Reply", columns, "   ")}
							</Text>
							<Text backgroundColor={theme.replyMsgBg} color={theme.replyMsgFg}>
								{wrapBubble(message.replyText, columns, "   ")}
							</Text>
						</>
					) : null}
					<Text backgroundColor={theme.userMsgBg} color={theme.userMsgFg} bold>
						{wrapBubble(message.text, columns, " ❯ ")}
					</Text>
				</Box>
			);
		case "thinking":
			return (
				<Box marginTop={1} paddingLeft={3} paddingRight={1}>
					<Text>
						{renderMarkdown(message.text, columns - 4, { dim: true })}
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
			const pad = "    ";
			const [title, ...body] = message.text.split("\n");
			// Labels are padded to equal width; the real separator "  " starts
			// at the longest label's length — which equals the max indexOf("  ").
			const sep = Math.max(...body.map((l) => l.indexOf("  ")));
			const valStart = sep + 2;
			return (
				<Box marginTop={1}>
					<Text backgroundColor={theme.statusBg}>
						<Text bold color={theme.accent}>
							{`${pad}${title}`.padEnd(columns)}
						</Text>
						{body.map((line) => (
							<Text key={line}>
								{"\n"}
								<Text bold>{`${pad}${line.slice(0, valStart)}`}</Text>
								{line.slice(valStart).padEnd(columns - pad.length - valStart)}
							</Text>
						))}
					</Text>
				</Box>
			);
		}
		case "info":
			if (message.variant === "compact_boundary") {
				return (
					<Box marginTop={1} paddingLeft={3} paddingRight={1}>
						<Text dimColor>{`~ ${message.text} ~`}</Text>
					</Box>
				);
			}
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
