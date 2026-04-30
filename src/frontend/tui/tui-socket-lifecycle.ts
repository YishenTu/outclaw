import { parseMessage, type ServerEvent } from "../../common/protocol.ts";
import { openRuntimeSocket } from "../runtime-client/index.ts";

export function openTuiRuntimeSocket(params: {
	agentName?: string;
	onClose(): void;
	onMessage(event: ServerEvent): void;
	onOpen(): void;
	url: string;
}): WebSocket {
	const socket = openRuntimeSocket(params.url, "tui", params.agentName);
	const { ws } = socket;

	void socket.ready.catch(() => {
		// onclose drives reconnect scheduling; suppress unhandled rejections.
	});

	ws.onopen = () => {
		params.onOpen();
	};
	ws.onclose = () => {
		params.onClose();
	};
	ws.onerror = () => {
		// onclose will fire after this; reconnect is handled there.
	};
	ws.onmessage = (message) => {
		params.onMessage(parseMessage(message.data as string) as ServerEvent);
	};

	return ws;
}
