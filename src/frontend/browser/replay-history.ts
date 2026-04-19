import {
	HEARTBEAT_DISPLAY_LABEL,
	isHeartbeatNoopResult,
	isOperationalHeartbeatPrompt,
} from "../../common/heartbeat-prompt.ts";
import type {
	DisplayChatMessage,
	DisplayMessage,
} from "../../common/protocol.ts";
import {
	isOperationalRolloverPrompt,
	isRolloverNoopResult,
	ROLLOVER_DISPLAY_LABEL,
} from "../../common/rollover-prompt.ts";

type AssistantMessage = DisplayChatMessage & { role: "assistant" };
type UserMessage = DisplayChatMessage & { role: "user" };

export function normalizeReplayHistory(
	messages: DisplayMessage[],
): DisplayMessage[] {
	const normalized: DisplayMessage[] = [];

	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (!message) {
			continue;
		}

		if (
			isUserMessage(message) &&
			isOperationalReplayPrompt(message, "heartbeat")
		) {
			const consumed = normalizeOperationalReplayPair({
				index,
				kind: "heartbeat",
				messages,
				normalized,
			});
			index += consumed;
			continue;
		}

		if (
			isUserMessage(message) &&
			isOperationalReplayPrompt(message, "rollover")
		) {
			const consumed = normalizeOperationalReplayPair({
				index,
				kind: "rollover",
				messages,
				normalized,
			});
			index += consumed;
			continue;
		}

		if (
			message.kind === "system" &&
			(message.event === "heartbeat" || message.event === "rollover")
		) {
			const consumed = normalizeOperationalReplayPair({
				index,
				kind: message.event,
				messages,
				normalized,
			});
			index += consumed;
			continue;
		}

		normalized.push(message);
	}

	return normalized;
}

function normalizeOperationalReplayPair(params: {
	index: number;
	kind: "heartbeat" | "rollover";
	messages: DisplayMessage[];
	normalized: DisplayMessage[];
}): number {
	const { index, kind, messages, normalized } = params;
	const nextMessage = messages[index + 1];

	if (!isAssistantMessage(nextMessage)) {
		normalized.push(createOperationalSystemMessage(kind));
		return 0;
	}

	const normalizedAssistant = normalizeOperationalAssistant(nextMessage, kind);
	if (!normalizedAssistant) {
		return 1;
	}

	normalized.push(createOperationalSystemMessage(kind), normalizedAssistant);
	return 1;
}

function createOperationalSystemMessage(
	kind: "heartbeat" | "rollover",
): Extract<DisplayMessage, { kind: "system" }> {
	return kind === "heartbeat"
		? {
				kind: "system",
				event: "heartbeat",
				text: HEARTBEAT_DISPLAY_LABEL,
			}
		: {
				kind: "system",
				event: "rollover",
				text: ROLLOVER_DISPLAY_LABEL,
			};
}

function isAssistantMessage(
	message: DisplayMessage | undefined,
): message is AssistantMessage {
	return message?.kind === "chat" && message.role === "assistant";
}

function isUserMessage(
	message: DisplayMessage | undefined,
): message is UserMessage {
	return message?.kind === "chat" && message.role === "user";
}

function normalizeOperationalAssistant(
	message: AssistantMessage,
	kind: "heartbeat" | "rollover",
): AssistantMessage | undefined {
	const images = message.images ?? [];
	const visibleText = isOperationalNoopResult(kind, message.content)
		? ""
		: message.content;

	if (visibleText === "" && images.length === 0) {
		return undefined;
	}

	return {
		...message,
		content: visibleText,
	};
}

function isOperationalReplayPrompt(
	message: UserMessage,
	kind: "heartbeat" | "rollover",
): boolean {
	return (
		message.replyContext === undefined &&
		(message.images?.length ?? 0) === 0 &&
		(kind === "heartbeat"
			? isOperationalHeartbeatPrompt(message.content)
			: isOperationalRolloverPrompt(message.content))
	);
}

function isOperationalNoopResult(
	kind: "heartbeat" | "rollover",
	text: string,
): boolean {
	return kind === "heartbeat"
		? isHeartbeatNoopResult(text)
		: isRolloverNoopResult(text);
}
