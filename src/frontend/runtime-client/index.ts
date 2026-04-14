import {
	type ImageRef,
	type ReplyContext,
	type RuntimeClientType,
	serialize,
} from "../../common/protocol.ts";

export interface RuntimeSocket {
	close: () => void;
	ready: Promise<void>;
	ws: WebSocket;
}

export interface RuntimeSocketConnectOptions {
	telegramBotId?: string;
	telegramUserId?: number;
}

export function isRuntimeSocketOpen(
	ws: WebSocket | null | undefined,
): ws is WebSocket {
	return ws !== null && ws !== undefined && ws.readyState === WebSocket.OPEN;
}

export function closeRuntimeSocket(ws: WebSocket) {
	if (
		ws.readyState === WebSocket.OPEN ||
		ws.readyState === WebSocket.CONNECTING
	) {
		ws.close();
	}
}

export function buildRuntimeSocketUrl(
	url: string,
	clientType: RuntimeClientType,
	agentName?: string,
	options?: RuntimeSocketConnectOptions,
): string {
	const runtimeUrl = new URL(url);
	runtimeUrl.searchParams.set("client", clientType);
	if (agentName) {
		runtimeUrl.searchParams.set("agent", agentName);
	}
	if (options?.telegramBotId) {
		runtimeUrl.searchParams.set("telegramBotId", options.telegramBotId);
	}
	if (options?.telegramUserId !== undefined) {
		runtimeUrl.searchParams.set(
			"telegramUserId",
			String(options.telegramUserId),
		);
	}
	return runtimeUrl.toString();
}

export function openRuntimeSocket(
	url: string,
	clientType: RuntimeClientType = "tui",
	agentName?: string,
	options?: RuntimeSocketConnectOptions,
): RuntimeSocket {
	const ws = new WebSocket(
		buildRuntimeSocketUrl(url, clientType, agentName, options),
	);
	const ready = new Promise<void>((resolve, reject) => {
		const handleOpen = () => {
			cleanup();
			resolve();
		};
		const handleError = () => {
			cleanup();
			reject(new Error("WebSocket error"));
		};
		const handleClose = () => {
			cleanup();
			reject(new Error("WebSocket closed before opening"));
		};
		const cleanup = () => {
			ws.removeEventListener("open", handleOpen);
			ws.removeEventListener("error", handleError);
			ws.removeEventListener("close", handleClose);
		};

		ws.addEventListener("open", handleOpen);
		ws.addEventListener("error", handleError);
		ws.addEventListener("close", handleClose);
	});

	return {
		close: () => closeRuntimeSocket(ws),
		ready,
		ws,
	};
}

function assertRuntimeSocketOpen(ws: WebSocket) {
	if (!isRuntimeSocketOpen(ws)) {
		throw new Error("Runtime socket is not connected");
	}
}

export function sendRequestSkills(ws: WebSocket) {
	assertRuntimeSocketOpen(ws);
	ws.send(serialize({ type: "request_skills" }));
}

export function sendRuntimeCommand(ws: WebSocket, command: string) {
	assertRuntimeSocketOpen(ws);
	ws.send(serialize({ type: "command", command }));
}

export function sendRuntimePrompt(
	ws: WebSocket,
	prompt: string,
	source?: "telegram",
	images?: ImageRef[],
	telegramChatId?: number,
	replyContext?: ReplyContext,
) {
	assertRuntimeSocketOpen(ws);
	ws.send(
		serialize({
			type: "prompt",
			prompt,
			source,
			images,
			telegramChatId,
			replyContext,
		}),
	);
}
