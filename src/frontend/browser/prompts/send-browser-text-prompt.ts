import {
	type DisplayChatMessage,
	extractError,
} from "../../../common/protocol.ts";
import { applyOptimisticBrowserPrompt } from "./optimistic-browser-prompt.ts";
import { preparePromptDispatch } from "./prepare-prompt-dispatch.ts";

interface DispatchBrowserTextPromptParams<SocketLike> {
	getActiveAgentId: () => string | null;
	getCurrentSessionKey: (agentId: string) => string;
	getSocket: () => SocketLike | null;
	input: string;
	isSocketOpen: (socket: SocketLike | null) => socket is SocketLike;
	pinSession: (sessionKey: string) => void;
	pushUserMessage: (sessionKey: string, message: DisplayChatMessage) => void;
	queueUserMessage: (sessionKey: string, message: DisplayChatMessage) => void;
	sendCommand: (command: string) => boolean;
	sendPrompt: (socket: SocketLike, prompt: string) => void;
	setRuntimeError: (error: string | null) => void;
	setSessionError: (sessionKey: string, error: string | null) => void;
	shouldQueuePrompt?: (sessionKey: string) => boolean;
	startAssistantTurn: (
		sessionKey: string,
		options?: { pendingPromptStart?: boolean },
	) => void;
}

export function dispatchBrowserTextPrompt<SocketLike>(
	params: DispatchBrowserTextPromptParams<SocketLike>,
): boolean {
	const prepared = preparePromptDispatch({
		input: params.input,
		hasImages: false,
		rejectRuntimeCommandWithImages: false,
		getActiveAgentId: params.getActiveAgentId,
		getCurrentSessionKey: params.getCurrentSessionKey,
		getSocket: params.getSocket,
		isSocketOpen: params.isSocketOpen,
		sendCommand: params.sendCommand,
		setRuntimeError: params.setRuntimeError,
	});
	if (prepared.kind === "empty") {
		return false;
	}
	if (prepared.kind === "runtime") {
		return prepared.result;
	}

	const { socket, sessionKey, prompt } = prepared;

	try {
		params.sendPrompt(socket, prompt);
	} catch (error) {
		params.setRuntimeError(extractError(error));
		return false;
	}

	params.pinSession(sessionKey);
	const message: DisplayChatMessage = {
		kind: "chat",
		role: "user",
		content: prompt,
		timestamp: Date.now(),
	};
	applyOptimisticBrowserPrompt({
		message,
		pushMessage: params.pushUserMessage,
		queueMessage: params.queueUserMessage,
		sessionKey,
		shouldQueuePrompt: params.shouldQueuePrompt,
		startAssistantTurn: params.startAssistantTurn,
	});
	params.setSessionError(sessionKey, null);
	params.setRuntimeError(null);
	return true;
}
