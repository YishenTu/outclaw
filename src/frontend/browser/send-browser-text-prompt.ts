import {
	canonicalizePromptSlashCommand,
	isRuntimeCommand,
} from "../../common/commands.ts";
import { extractError } from "../../common/protocol.ts";

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
	const trimmed = params.input.trim();
	if (trimmed === "") {
		return false;
	}

	if (isRuntimeCommand(trimmed)) {
		return params.sendCommand(trimmed);
	}

	const agentId = params.getActiveAgentId();
	const socket = params.getSocket();
	if (!agentId || !params.isSocketOpen(socket)) {
		params.setRuntimeError("Runtime disconnected");
		return false;
	}

	const prompt = canonicalizePromptSlashCommand(trimmed) ?? trimmed;
	try {
		params.sendPrompt(socket, prompt);
	} catch (error) {
		params.setRuntimeError(extractError(error));
		return false;
	}

	const sessionKey = params.getCurrentSessionKey(agentId);
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
