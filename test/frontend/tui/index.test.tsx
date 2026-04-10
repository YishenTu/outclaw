import { afterEach, describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { startTui } from "../../../src/frontend/tui/index.tsx";

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readyState = FakeWebSocket.CONNECTING;
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

	send(_data: string) {}

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

describe("startTui", () => {
	const realWebSocket = globalThis.WebSocket;
	const realStdout = process.stdout;
	const realStderr = process.stderr;
	const realStdin = process.stdin;

	afterEach(() => {
		globalThis.WebSocket = realWebSocket;
		FakeWebSocket.reset();
		Object.defineProperty(process, "stdout", { value: realStdout });
		Object.defineProperty(process, "stderr", { value: realStderr });
		Object.defineProperty(process, "stdin", { value: realStdin });
	});

	test("renders the TUI app and returns the Ink instance", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const stdout = createOutputStream();
		const stderr = createOutputStream();
		const stdin = new PassThrough() as unknown as NodeJS.ReadStream & {
			isTTY: boolean;
		};
		stdin.isTTY = false;

		Object.defineProperty(process, "stdout", { value: stdout });
		Object.defineProperty(process, "stderr", { value: stderr });
		Object.defineProperty(process, "stdin", { value: stdin });

		const instance = startTui("ws://localhost:4100");
		await new Promise<void>((resolve) => setImmediate(resolve));

		expect(instance.unmount).toBeFunction();
		expect(instance.cleanup).toBeFunction();
		expect(FakeWebSocket.instances[0]?.url).toBe(
			"ws://localhost:4100/?client=tui",
		);

		instance.unmount();
		instance.cleanup();
	});
});
