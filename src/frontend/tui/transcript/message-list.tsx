import { Box, Text } from "ink";
import { memo } from "react";
import { renderMarkdown } from "./markdown.ts";
import { MessageItem } from "./message-item.tsx";
import { Spinner } from "./spinner.tsx";
import type { TuiMessage } from "./state.ts";

interface MessageListProps {
	messages: TuiMessage[];
	streaming: string;
	streamingThinking: string;
	running: boolean;
	compacting: boolean;
	columns: number;
}

export const MessageList = memo(function MessageList({
	messages,
	streaming,
	streamingThinking,
	running,
	compacting,
	columns,
}: MessageListProps) {
	const hasAssistantOutput = streaming !== "" || streamingThinking !== "";

	return (
		<Box flexDirection="column">
			{messages.map((message) => (
				<MessageItem key={message.id} message={message} columns={columns} />
			))}
			{streamingThinking ? (
				<Box marginTop={1} paddingLeft={3} paddingRight={1}>
					<Text>
						{renderMarkdown(streamingThinking, columns - 4, { dim: true })}
					</Text>
				</Box>
			) : null}
			{streaming ? (
				<Box marginTop={1} paddingLeft={3} paddingRight={1}>
					<Text>{renderMarkdown(streaming, columns - 4)}</Text>
				</Box>
			) : null}
			{compacting ? (
				<Box marginTop={1} paddingLeft={1} paddingRight={1}>
					<Spinner label="Compacting..." />
				</Box>
			) : running ? (
				<Box marginTop={1} paddingLeft={1} paddingRight={1}>
					<Spinner label={hasAssistantOutput ? "Working..." : "Thinking..."} />
				</Box>
			) : null}
		</Box>
	);
});
