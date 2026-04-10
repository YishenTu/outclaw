import { afterEach, describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { TuiApp } from "../../../src/frontend/tui/app.tsx";

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readyState = FakeWebSocket.CONNECTING;
	readonly sent: string[] = [];
	onclose: ((event?: unknown) => void) | null = null;
	onerror: ((event?: unknown) => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onopen: ((event?: unknown) => void) | null = null;
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
		if (type === "open") {
			this.onopen?.(event);
			return;
		}
		const propertyHandler =
			type === "close" ? this.onclose : type === "error" ? this.onerror : null;
		propertyHandler?.(event);
	}
}

function createOutputStream() {
	const stream = new PassThrough() as PassThrough &
		NodeJS.WriteStream & {
			columns: number;
			isTTY: boolean;
			rows: number;
		};
	stream.columns = 80;
	stream.isTTY = false;
	stream.rows = 24;
	return stream;
}

async function flushUpdates() {
	for (let index = 0; index < 5; index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

async function renderApp() {
	const stdout = createOutputStream();
	const stderr = createOutputStream();
	const stdin = new PassThrough() as PassThrough & {
		isTTY: boolean;
	};
	stdin.isTTY = false;

	const app = render(<TuiApp url="ws://localhost:4100" />, {
		exitOnCtrlC: false,
		patchConsole: false,
		stderr,
		stdin: stdin as unknown as NodeJS.ReadStream & { isTTY: boolean },
		stdout,
	});

	await flushUpdates();

	const socket = FakeWebSocket.instances[0] as FakeWebSocket;
	socket.dispatch("open");
	await flushUpdates();

	return { app, socket, stdin };
}

async function typeText(stdin: PassThrough, value: string) {
	stdin.write(value);
	await flushUpdates();
}

async function pressEnter(stdin: PassThrough) {
	stdin.write("\r");
	await flushUpdates();
}

describe("TuiApp", () => {
	const realWebSocket = globalThis.WebSocket;

	afterEach(() => {
		globalThis.WebSocket = realWebSocket;
		FakeWebSocket.reset();
	});

	test("first Enter on a partial slash command only autocompletes; second Enter sends it", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const { app, socket, stdin } = await renderApp();

		try {
			await typeText(stdin, "/s");
			expect(socket.sent).toEqual(['{"type":"request_skills"}']);

			await pressEnter(stdin);
			expect(socket.sent).toEqual(['{"type":"request_skills"}']);

			await pressEnter(stdin);
			expect(socket.sent).toEqual([
				'{"type":"request_skills"}',
				'{"type":"command","command":"/session"}',
			]);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("first Enter on an exact slash command still does not send immediately", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const { app, socket, stdin } = await renderApp();

		try {
			await typeText(stdin, "/status");
			expect(socket.sent).toEqual(['{"type":"request_skills"}']);

			await pressEnter(stdin);
			expect(socket.sent).toEqual(['{"type":"request_skills"}']);

			await pressEnter(stdin);
			expect(socket.sent).toEqual([
				'{"type":"request_skills"}',
				'{"type":"command","command":"/status"}',
			]);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});
});
