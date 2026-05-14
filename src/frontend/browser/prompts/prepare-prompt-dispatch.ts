import {
	canonicalizePromptSlashCommand,
	isRuntimeCommand,
} from "../../../common/commands.ts";

export type PreparedPromptDispatch<SocketLike> =
	| { kind: "empty" }
	| { kind: "runtime"; result: boolean }
	| {
			kind: "prompt";
			agentId: string;
			socket: SocketLike;
			sessionKey: string;
			prompt: string;
	  };

interface PreparePromptDispatchParams<SocketLike> {
	input: string;
	hasImages: boolean;
	rejectRuntimeCommandWithImages: boolean;
	getActiveAgentId: () => string | null;
	getCurrentSessionKey: (agentId: string) => string;
	getSocket: () => SocketLike | null;
	isSocketOpen: (socket: SocketLike | null) => socket is SocketLike;
	sendCommand: (command: string) => boolean;
	setRuntimeError: (error: string | null) => void;
}

export function preparePromptDispatch<SocketLike>(
	params: PreparePromptDispatchParams<SocketLike>,
): PreparedPromptDispatch<SocketLike> {
	const trimmed = params.input.trim();
	if (trimmed === "" && !params.hasImages) {
		return { kind: "empty" };
	}

	if (trimmed !== "" && isRuntimeCommand(trimmed)) {
		if (params.hasImages && params.rejectRuntimeCommandWithImages) {
			params.setRuntimeError("Runtime commands cannot include images");
			return { kind: "runtime", result: false };
		}
		return { kind: "runtime", result: params.sendCommand(trimmed) };
	}

	const agentId = params.getActiveAgentId();
	const socket = params.getSocket();
	if (!agentId || !params.isSocketOpen(socket)) {
		params.setRuntimeError("Runtime disconnected");
		return { kind: "runtime", result: false };
	}

	const sessionKey = params.getCurrentSessionKey(agentId);
	const prompt =
		trimmed === "" ? "" : (canonicalizePromptSlashCommand(trimmed) ?? trimmed);

	return { kind: "prompt", agentId, socket, sessionKey, prompt };
}
