import type { DisplayChatMessage } from "../../../common/protocol.ts";

interface ApplyOptimisticBrowserPromptParams {
	message: DisplayChatMessage;
	pushMessage: (sessionKey: string, message: DisplayChatMessage) => void;
	queueMessage: (sessionKey: string, message: DisplayChatMessage) => void;
	sessionKey: string;
	shouldQueuePrompt?: (sessionKey: string) => boolean;
	startAssistantTurn: (
		sessionKey: string,
		options?: { pendingPromptStart?: boolean },
	) => void;
}

export function applyOptimisticBrowserPrompt({
	message,
	pushMessage,
	queueMessage,
	sessionKey,
	shouldQueuePrompt,
	startAssistantTurn,
}: ApplyOptimisticBrowserPromptParams) {
	if (shouldQueuePrompt?.(sessionKey)) {
		queueMessage(sessionKey, message);
		return;
	}

	pushMessage(sessionKey, message);
	startAssistantTurn(sessionKey, { pendingPromptStart: true });
}
