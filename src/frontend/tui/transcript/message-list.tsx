import { Box, Text } from "ink";
import { renderMarkdown } from "./markdown.ts";
import { MessageItem } from "./message-item.tsx";
import { Spinner } from "./spinner.tsx";
import type { TuiMessage } from "./state.ts";

interface MessageListProps {
	messages: TuiMessage[];
	streaming: string;
	streamingThinking: string;
	running: boolean;
	columns: number;
}

export function MessageList({
	messages,
	streaming,
	streamingThinking,
	running,
	columns,
}: MessageListProps) {
	return (
		<Box flexDirection="column">
			{messages.map((msg) => (
				<MessageItem key={msg.id} message={msg} columns={columns} />
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
			{running && !streaming && !streamingThinking ? (
				<Box marginTop={1} paddingLeft={1} paddingRight={1}>
					<Spinner label="Thinking..." />
				</Box>
			) : null}
		</Box>
	);
}
