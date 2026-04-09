import { Box, Text } from "ink";
import { MessageItem } from "./message-item.tsx";
import { Spinner } from "./spinner.tsx";
import type { TuiMessage } from "./state.ts";

interface MessageListProps {
	messages: TuiMessage[];
	streaming: string;
	running: boolean;
	columns: number;
}

export function MessageList({
	messages,
	streaming,
	running,
	columns,
}: MessageListProps) {
	return (
		<Box flexDirection="column">
			{messages.map((msg) => (
				<MessageItem key={msg.id} message={msg} columns={columns} />
			))}
			{streaming ? (
				<Box marginTop={1} paddingLeft={3} paddingRight={1}>
					<Text>{streaming}</Text>
				</Box>
			) : null}
			{running && !streaming ? (
				<Box marginTop={1} paddingLeft={1} paddingRight={1}>
					<Spinner label="Thinking..." />
				</Box>
			) : null}
		</Box>
	);
}
