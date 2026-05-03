import { Box, Static, Text } from "ink";
import { memo, type ReactNode } from "react";
import { QUEUED_PROMPT_LABEL } from "../../../common/queued-prompt.ts";
import { renderMarkdown } from "./markdown.ts";
import { MessageItem } from "./message-item.tsx";
import { Spinner } from "./spinner.tsx";
import type { TuiMessage, TuiQueuedPrompt } from "./state.ts";
import { useAppendOnlyStaticTranscript } from "./static-transcript.ts";

interface MessageListProps {
	messages: TuiMessage[];
	activePrompt?: TuiMessage;
	streaming: string;
	streamingThinking: string;
	running: boolean;
	compacting: boolean;
	heartbeatPending?: boolean;
	queuedPrompts?: TuiQueuedPrompt[];
	columns: number;
	transcriptVersion?: number;
	staticPrefix?: ReactNode;
}

export const MessageList = memo(function MessageList({
	messages,
	activePrompt,
	streaming,
	streamingThinking,
	running,
	compacting,
	heartbeatPending = false,
	queuedPrompts = [],
	columns,
	transcriptVersion = 0,
	staticPrefix,
}: MessageListProps) {
	const hasAssistantOutput = streaming !== "" || streamingThinking !== "";
	const pendingHeartbeat =
		heartbeatPending && messages.at(-1)?.variant === "heartbeat"
			? messages.at(-1)
			: undefined;
	const staticMessageCount = pendingHeartbeat
		? Math.max(0, messages.length - 1)
		: messages.length;
	const staticItems = useAppendOnlyStaticTranscript(
		messages,
		staticMessageCount,
		transcriptVersion,
		staticPrefix,
	);

	return (
		<>
			<Static items={staticItems}>
				{(item) => (
					<Box key={item.key}>
						{item.kind === "prefix" ? (
							item.node
						) : (
							<MessageItem message={item.message} columns={columns} />
						)}
					</Box>
				)}
			</Static>
			<Box flexDirection="column">
				{pendingHeartbeat ? (
					<MessageItem message={pendingHeartbeat} columns={columns} />
				) : null}
				{activePrompt ? (
					<MessageItem message={activePrompt} columns={columns} />
				) : null}
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
						<Spinner
							label={hasAssistantOutput ? "Working..." : "Thinking..."}
						/>
					</Box>
				) : null}
				{queuedPrompts.map((prompt) => (
					<Box key={prompt.id} flexDirection="column">
						<MessageItem
							message={{ id: prompt.id, role: "user", text: prompt.text }}
							columns={columns}
						/>
						<Box paddingLeft={3} paddingRight={1}>
							<Text dimColor>{QUEUED_PROMPT_LABEL}</Text>
						</Box>
					</Box>
				))}
			</Box>
		</>
	);
});
