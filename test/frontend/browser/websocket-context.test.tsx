import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
	vi,
} from "bun:test";
import { PassThrough } from "node:stream";
import { render, Text } from "ink";
import { WebSocketProvider } from "../../../src/frontend/browser/contexts/websocket-context.tsx";
import { useRuntimeStore } from "../../../src/frontend/browser/stores/runtime.ts";

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

		const propertyHandler =
			type === "open"
				? this.onopen
				: type === "close"
					? this.onclose
					: type === "error"
						? this.onerror
						: null;
		propertyHandler?.(event);
	}
}

interface TestDocument {
	addEventListener(type: string, handler: () => void): void;
	removeEventListener(type: string, handler: () => void): void;
	visibilityState: "hidden" | "visible";
}

interface TestWindow {
	location: {
		host: string;
		protocol: string;
	};
}

const globalScope = globalThis as unknown as {
	document?: TestDocument;
	window?: TestWindow;
};
const realDocument = globalScope.document;
const realFetch = globalThis.fetch;
const realWebSocket = globalThis.WebSocket;
const realWindow = globalScope.window;

function resetStore<TState>(store: {
	getInitialState(): TState;
	setState(state: TState, replace: true): void;
}) {
	store.setState(store.getInitialState(), true);
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

function resolveFetchPath(input: RequestInfo | URL): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.pathname;
	}
	return new URL(input.url).pathname;
}

describe("WebSocketProvider sidebar refresh", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetStore(useRuntimeStore);
		FakeWebSocket.reset();
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
		globalScope.window = {
			location: {
				host: "localhost:4000",
				protocol: "http:",
			},
		};
		globalScope.document = {
			addEventListener() {},
			removeEventListener() {},
			visibilityState: "visible",
		};
	});

	afterEach(() => {
		vi.useRealTimers();
		globalThis.fetch = realFetch;
		globalThis.WebSocket = realWebSocket;
		if (realDocument === undefined) {
			delete globalScope.document;
		} else {
			globalScope.document = realDocument;
		}
		if (realWindow === undefined) {
			delete globalScope.window;
		} else {
			globalScope.window = realWindow;
		}
		FakeWebSocket.reset();
		resetStore(useRuntimeStore);
	});

	test("does not poll the sidebar summary after connection", async () => {
		let sidebarFetches = 0;
		globalThis.fetch = mock(async (input: RequestInfo | URL) => {
			const path = resolveFetchPath(input);
			if (path === "/api/agents") {
				sidebarFetches += 1;
				return Response.json({
					activeAgentId: "agent-railly",
					agents: [],
				});
			}
			if (path === "/api/latency") {
				return Response.json({ ok: true });
			}
			throw new Error(`Unexpected fetch: ${path}`);
		}) as unknown as typeof fetch;

		const app = render(
			<WebSocketProvider>
				<Text>browser</Text>
			</WebSocketProvider>,
			{
				stdout: createOutputStream(),
				stderr: createOutputStream(),
			},
		);

		await flushUpdates();
		FakeWebSocket.instances[0]?.dispatch("open");
		await flushUpdates();
		expect(sidebarFetches).toBe(1);

		vi.advanceTimersByTime(15_000);
		await flushUpdates();

		expect(sidebarFetches).toBe(1);
		app.unmount();
	});
});
