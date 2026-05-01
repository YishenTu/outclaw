import { extractError } from "../../../common/protocol.ts";
import { preparePromptDispatch } from "./prepare-prompt-dispatch.ts";

interface DispatchBrowserTextPromptParams<SocketLike> {
	getActiveAgentId: () => string | null;
	getCurrentSessionKey: (agentId: string) => string;
	getSocket: () => SocketLike | null;
	input: string;
	isSocketOpen: (socket: SocketLike | null) => socket is SocketLike;
	pinSession: (sessionKey: string) => void;
	pushUserMessage: (
		sessionKey: string,
		message: {
			kind: "chat";
			role: "user";
			content: string;
			timestamp?: number;
		},
	) => void;
	sendCommand: (command: string) => boolean;
	sendPrompt: (socket: SocketLike, prompt: string) => void;
	setRuntimeError: (error: string | null) => void;
	setSessionError: (sessionKey: string, error: string | null) => void;
	startAssistantTurn: (sessionKey: string) => void;
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
	params.pushUserMessage(sessionKey, {
		kind: "chat",
		role: "user",
		content: prompt,
		timestamp: Date.now(),
	});
	params.startAssistantTurn(sessionKey);
	params.setSessionError(sessionKey, null);
	params.setRuntimeError(null);
	return true;
}
