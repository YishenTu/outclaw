import { afterEach, describe, expect, mock, test } from "bun:test";
import {
	buildRuntimeSocketUrl,
	closeRuntimeSocket,
	isRuntimeSocketOpen,
	openRuntimeSocket,
	sendRuntimeCommand,
	sendRuntimePrompt,
} from "../../src/frontend/runtime-client/index.ts";

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readyState = FakeWebSocket.CONNECTING;
	readonly sent: string[] = [];
	closeCount = 0;
	onclose: ((event?: unknown) => void) | null = null;
	onerror: ((event?: unknown) => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	private listeners = new Map<string, Set<(event?: unknown) => void>>();

	constructor(readonly url: string) {
		FakeWebSocket.instances.push(this);
	}

	static reset() {
		FakeWebSocket.instances.length = 0;
	}

	addEventListener(type: string, handler: (event?: unknown) => void) {
		let handlers = this.listeners.get(type);
		if (!handlers) {
			handlers = new Set();
			this.listeners.set(type, handlers);
		}
		handlers.add(handler);
	}

	removeEventListener(type: string, handler: (event?: unknown) => void) {
		this.listeners.get(type)?.delete(handler);
	}

	send(data: string) {
		this.sent.push(data);
	}

	close() {
		this.closeCount++;
		this.readyState = FakeWebSocket.CLOSED;
		this.dispatch("close");
	}

	dispatch(type: "open" | "error" | "close" | "message", event?: unknown) {
		if (type === "open") {
			this.readyState = FakeWebSocket.OPEN;
		}
		if (type === "close") {
			this.readyState = FakeWebSocket.CLOSED;
		}
		for (const handler of this.listeners.get(type) ?? []) {
			handler(event);
		}
		if (type === "message") {
			this.onmessage?.(event as { data: string });
			return;
		}

		const propertyHandler =
			type === "close" ? this.onclose : type === "error" ? this.onerror : null;
		propertyHandler?.(event);
	}
}

describe("runtime client", () => {
	const realWebSocket = globalThis.WebSocket;

	afterEach(() => {
		globalThis.WebSocket = realWebSocket;
		FakeWebSocket.reset();
	});

	test("adds the client type to the runtime socket URL", () => {
		expect(buildRuntimeSocketUrl("ws://localhost:4000", "telegram")).toBe(
			"ws://localhost:4000/?client=telegram",
		);
		expect(buildRuntimeSocketUrl("ws://localhost:4000", "tui", "railly")).toBe(
			"ws://localhost:4000/?client=tui&agent=railly",
		);
		expect(
			buildRuntimeSocketUrl("ws://localhost:4000", "telegram", undefined, {
				telegramBotId: "bot-a",
				telegramUserId: 101,
			}),
		).toBe(
			"ws://localhost:4000/?client=telegram&telegramBotId=bot-a&telegramUserId=101",
		);
	});

	test("serializes prompt images into the websocket message", () => {
		const send = mock((_data: string) => {});
		const ws = { send, readyState: WebSocket.OPEN } as unknown as WebSocket;

		sendRuntimePrompt(
			ws,
			"",
			"telegram",
			[{ path: "/tmp/cat.png", mediaType: "image/png" }],
			undefined,
			{ text: 'earlier "note"' },
		);

		expect(send).toHaveBeenCalledTimes(1);
		expect(JSON.parse(send.mock.calls[0]?.[0] as string)).toEqual({
			type: "prompt",
			prompt: "",
			source: "telegram",
			images: [{ path: "/tmp/cat.png", mediaType: "image/png" }],
			replyContext: { text: 'earlier "note"' },
		});
	});

	test("isRuntimeSocketOpen only accepts open sockets", () => {
		expect(isRuntimeSocketOpen(undefined)).toBeFalse();
		expect(
			isRuntimeSocketOpen({
				readyState: WebSocket.CONNECTING,
			} as WebSocket),
		).toBeFalse();
		expect(
			isRuntimeSocketOpen({
				readyState: WebSocket.OPEN,
			} as WebSocket),
		).toBeTrue();
	});

	test("send helpers reject sockets that are not open", () => {
		const send = mock((_data: string) => {});
		const ws = {
			send,
			readyState: WebSocket.CLOSED,
		} as unknown as WebSocket;

		expect(() => sendRuntimeCommand(ws, "/status")).toThrow(
			"Runtime socket is not connected",
		);
		expect(() => sendRuntimePrompt(ws, "hello")).toThrow(
			"Runtime socket is not connected",
		);
		expect(send).not.toHaveBeenCalled();
	});

	test("openRuntimeSocket resolves on open and close() closes connecting sockets", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const socket = openRuntimeSocket("ws://localhost:4000", "tui", "railly");
		const ws = FakeWebSocket.instances[0] as FakeWebSocket;
		expect(ws?.url).toBe("ws://localhost:4000/?client=tui&agent=railly");

		ws.dispatch("open");
		await expect(socket.ready).resolves.toBeUndefined();

		socket.close();
		expect(ws.closeCount).toBe(1);
	});

	test("openRuntimeSocket includes Telegram routing query parameters", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const socket = openRuntimeSocket(
			"ws://localhost:4000",
			"telegram",
			undefined,
			{
				telegramBotId: "bot-a",
				telegramUserId: 101,
			},
		);
		const ws = FakeWebSocket.instances[0] as FakeWebSocket;
		expect(ws?.url).toBe(
			"ws://localhost:4000/?client=telegram&telegramBotId=bot-a&telegramUserId=101",
		);

		ws.dispatch("open");
		await expect(socket.ready).resolves.toBeUndefined();
	});

	test("openRuntimeSocket rejects on websocket error before opening", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const socket = openRuntimeSocket("ws://localhost:4000", "telegram");
		const ws = FakeWebSocket.instances[0] as FakeWebSocket;
		ws.dispatch("error");

		await expect(socket.ready).rejects.toThrow("WebSocket error");
	});

	test("openRuntimeSocket rejects when the websocket closes before opening", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const socket = openRuntimeSocket("ws://localhost:4000", "telegram");
		const ws = FakeWebSocket.instances[0] as FakeWebSocket;
		ws.dispatch("close");

		await expect(socket.ready).rejects.toThrow(
			"WebSocket closed before opening",
		);
	});

	test("closeRuntimeSocket ignores sockets that are already closed", () => {
		const close = mock(() => {});
		const ws = {
			close,
			readyState: WebSocket.CLOSED,
		} as unknown as WebSocket;

		closeRuntimeSocket(ws);

		expect(close).not.toHaveBeenCalled();
	});
});
