import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTelegramBridge } from "../../../../src/frontend/telegram/bridge/client.ts";
import { createRuntime } from "../../../../src/runtime/transport/ws-server.ts";
import { MockFacade } from "../../../helpers/mock-facade.ts";

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
			type === "close" ? this.onclose : type === "error" ? this.onerror : null;
		propertyHandler?.(event);
	}
}

async function flushMicrotasks() {
	await Promise.resolve();
	await Promise.resolve();
}

function createClosingServer() {
	const server = Bun.serve({
		port: 0,
		fetch(req, runtime) {
			if (runtime.upgrade(req)) {
				return;
			}
			return new Response("ok");
		},
		websocket: {
			message(ws) {
				ws.close();
			},
		},
	});

	return {
		port: server.port as number,
		stop() {
			server.stop();
		},
	};
}

function createStatusServer(message: string) {
	const server = Bun.serve({
		port: 0,
		fetch(req, runtime) {
			if (runtime.upgrade(req)) {
				return;
			}
			return new Response("ok");
		},
		websocket: {
			message(ws) {
				ws.send(JSON.stringify({ type: "status", message }));
			},
		},
	});

	return {
		port: server.port as number,
		stop() {
			server.stop();
		},
	};
}

describe("Telegram bridge", () => {
	let server: ReturnType<typeof createRuntime>;
	let facade: MockFacade;
	const imageTmp = mkdtempSync(join(tmpdir(), "mis-telegram-bridge-"));
	const realWebSocket = globalThis.WebSocket;

	function createImagePath(name: string): string {
		const path = join(imageTmp, name);
		writeFileSync(path, "bytes");
		return path;
	}

	beforeAll(() => {
		facade = new MockFacade();
		server = createRuntime({ port: 0, facade });
	});

	afterAll(() => {
		server.stop();
		rmSync(imageTmp, { recursive: true, force: true });
	});

	afterEach(() => {
		globalThis.WebSocket = realWebSocket;
		FakeWebSocket.reset();
	});

	test("sends a prompt and collects the full response", async () => {
		const bridge = createTelegramBridge(`ws://localhost:${server.port}`);

		const response = await bridge.send("hello");

		expect(response).toBe("echo: hello");

		bridge.close();
	});

	test("handles multi-turn via the same bridge", async () => {
		const bridge = createTelegramBridge(`ws://localhost:${server.port}`);

		const r1 = await bridge.send("first");
		expect(r1).toBe("echo: first");

		const r2 = await bridge.send("second");
		expect(r2).toBe("echo: second");

		bridge.close();
	});

	test("calls onText callback with accumulated text", async () => {
		const bridge = createTelegramBridge(`ws://localhost:${server.port}`);

		const calls: string[] = [];
		const response = await bridge.send("hello", (accumulated) => {
			calls.push(accumulated);
		});

		expect(response).toBe("echo: hello");
		expect(calls).toContain("echo: hello");

		bridge.close();
	});

	test("stream() yields text deltas", async () => {
		const bridge = createTelegramBridge(`ws://localhost:${server.port}`);

		const chunks: string[] = [];
		for await (const chunk of bridge.stream("hello")) {
			chunks.push(chunk);
		}

		expect(chunks.join("")).toBe("echo: hello");

		bridge.close();
	});

	test("stream() forwards image events to callback", async () => {
		const bridge = createTelegramBridge(`ws://localhost:${server.port}`);
		const imagePath = createImagePath("bridge-chart.png");
		facade.textChunks = [`Saved chart to ${imagePath}`];

		try {
			const chunks: string[] = [];
			const imageEvents: Array<{ type: string; path: string }> = [];

			for await (const chunk of bridge.stream("hello", undefined, (event) => {
				imageEvents.push(event);
			})) {
				chunks.push(chunk);
			}

			expect(chunks.join("")).toBe(`Saved chart to ${imagePath}`);
			expect(imageEvents).toEqual([{ type: "image", path: imagePath }]);
		} finally {
			facade.textChunks = undefined;
			bridge.close();
		}
	});

	test("stream() forwards prompt images", async () => {
		const bridge = createTelegramBridge(`ws://localhost:${server.port}`);

		const chunks: string[] = [];
		for await (const chunk of bridge.stream("", [
			{ path: "/tmp/cat.png", mediaType: "image/png" },
		])) {
			chunks.push(chunk);
		}

		expect(chunks.join("")).toBe("echo: ");
		expect(facade.lastParams?.images).toEqual([
			{ path: "/tmp/cat.png", mediaType: "image/png" },
		]);

		bridge.close();
	});

	test("sendCommandAndWait() returns command responses", async () => {
		const bridge = createTelegramBridge(`ws://localhost:${server.port}`);
		const event = await bridge.sendCommandAndWait("/model");

		expect(event.type).toBe("model_changed");
		expect(event.model).toBe("opus");

		bridge.close();
	});

	test("send() rejects when the runtime socket closes unexpectedly", async () => {
		const closingServer = createClosingServer();
		const bridge = createTelegramBridge(`ws://localhost:${closingServer.port}`);

		try {
			await expect(bridge.send("hello")).rejects.toThrow("WebSocket closed");
		} finally {
			bridge.close();
			closingServer.stop();
		}
	});

	test("sendCommandAndWait() rejects when the runtime socket closes unexpectedly", async () => {
		const closingServer = createClosingServer();
		const bridge = createTelegramBridge(`ws://localhost:${closingServer.port}`);

		try {
			await expect(bridge.sendCommandAndWait("/model")).rejects.toThrow(
				"WebSocket closed",
			);
		} finally {
			bridge.close();
			closingServer.stop();
		}
	});

	test("stream() throws when the runtime socket closes unexpectedly", async () => {
		const closingServer = createClosingServer();
		const bridge = createTelegramBridge(`ws://localhost:${closingServer.port}`);

		try {
			const consume = async () => {
				for await (const _chunk of bridge.stream("hello")) {
					// Drain
				}
			};

			await expect(consume()).rejects.toThrow("WebSocket closed");
		} finally {
			bridge.close();
			closingServer.stop();
		}
	});

	test("send() rejects with runtime status messages", async () => {
		const statusServer = createStatusServer("Runtime shutting down");
		const bridge = createTelegramBridge(`ws://localhost:${statusServer.port}`);

		try {
			await expect(bridge.send("hello")).rejects.toThrow(
				"Runtime shutting down",
			);
		} finally {
			bridge.close();
			statusServer.stop();
		}
	});

	test("stream() throws with runtime status messages", async () => {
		const statusServer = createStatusServer("Runtime shutting down");
		const bridge = createTelegramBridge(`ws://localhost:${statusServer.port}`);

		try {
			const consume = async () => {
				for await (const _chunk of bridge.stream("hello")) {
					// Drain
				}
			};

			await expect(consume()).rejects.toThrow("Runtime shutting down");
		} finally {
			bridge.close();
			statusServer.stop();
		}
	});

	test("send() rejects with fallback messages for status and error events", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
		const bridge = createTelegramBridge("ws://fake");

		const statusPromise = bridge.send("hello");
		const statusSocket = FakeWebSocket.instances[0] as FakeWebSocket;
		statusSocket.dispatch("open");
		await flushMicrotasks();
		statusSocket.dispatch("message", {
			data: JSON.stringify({ type: "status", message: { detail: "nope" } }),
		});
		await expect(statusPromise).rejects.toThrow("Unexpected status event");

		const errorPromise = bridge.send("hello");
		const errorSocket = FakeWebSocket.instances[1] as FakeWebSocket;
		errorSocket.dispatch("open");
		await flushMicrotasks();
		errorSocket.dispatch("message", {
			data: JSON.stringify({ type: "error" }),
		});
		await expect(errorPromise).rejects.toThrow("Unknown error");

		bridge.close();
	});

	test("send() rejects on websocket error after opening", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
		const bridge = createTelegramBridge("ws://fake");

		const response = bridge.send("hello");
		const ws = FakeWebSocket.instances[0] as FakeWebSocket;
		ws.dispatch("open");
		await flushMicrotasks();
		ws.dispatch("error");

		await expect(response).rejects.toThrow("WebSocket error");
		bridge.close();
	});

	test("sendCommandAndWait() ignores non-matching events when expectedTypes is provided", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
		const bridge = createTelegramBridge("ws://fake");

		let settled = false;
		const response = bridge
			.sendCommandAndWait("/model", new Set(["model_changed"]))
			.then((event) => {
				settled = true;
				return event;
			});
		const ws = FakeWebSocket.instances[0] as FakeWebSocket;
		ws.dispatch("open");
		await flushMicrotasks();
		ws.dispatch("message", {
			data: JSON.stringify({ type: "status", message: "ignore me" }),
		});
		await flushMicrotasks();
		expect(settled).toBeFalse();

		ws.dispatch("message", {
			data: JSON.stringify({ type: "model_changed", model: "haiku" }),
		});
		await expect(response).resolves.toEqual({
			type: "model_changed",
			model: "haiku",
		});

		bridge.close();
	});

	test("sendCommandAndWait() ignores runtime_status before the real command response", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
		const bridge = createTelegramBridge("ws://fake");

		let settled = false;
		const response = bridge.sendCommandAndWait("/model").then((event) => {
			settled = true;
			return event;
		});
		const ws = FakeWebSocket.instances[0] as FakeWebSocket;
		ws.dispatch("open");
		await flushMicrotasks();
		ws.dispatch("message", {
			data: JSON.stringify({
				type: "runtime_status",
				model: "opus",
				effort: "high",
			}),
		});
		await flushMicrotasks();
		expect(settled).toBeFalse();

		ws.dispatch("message", {
			data: JSON.stringify({ type: "model_changed", model: "haiku" }),
		});
		await expect(response).resolves.toEqual({
			type: "model_changed",
			model: "haiku",
		});

		bridge.close();
	});

	test("sendCommandAndWait() accepts requested runtime_status for /status", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
		const bridge = createTelegramBridge("ws://fake");

		const response = bridge.sendCommandAndWait(
			"/status",
			new Set(["runtime_status"]),
		);
		const ws = FakeWebSocket.instances[0] as FakeWebSocket;
		ws.dispatch("open");
		await flushMicrotasks();

		// Initial unsolicited status (no requested flag) should be ignored.
		ws.dispatch("message", {
			data: JSON.stringify({
				type: "runtime_status",
				model: "opus",
				effort: "high",
			}),
		});
		await flushMicrotasks();

		// Requested status should resolve.
		ws.dispatch("message", {
			data: JSON.stringify({
				type: "runtime_status",
				model: "opus",
				effort: "high",
				requested: true,
			}),
		});
		await expect(response).resolves.toMatchObject({
			type: "runtime_status",
			requested: true,
		});

		bridge.close();
	});

	test("sendCommandAndWait() rejects on websocket error after opening", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
		const bridge = createTelegramBridge("ws://fake");

		const response = bridge.sendCommandAndWait("/model");
		const ws = FakeWebSocket.instances[0] as FakeWebSocket;
		ws.dispatch("open");
		await flushMicrotasks();
		ws.dispatch("error");

		await expect(response).rejects.toThrow("WebSocket error");
		bridge.close();
	});

	test("stream() drains queued text, ignores images without a callback, and closes cleanly", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
		const bridge = createTelegramBridge("ws://fake");
		const iterator = bridge.stream("hello")[Symbol.asyncIterator]();

		const firstChunk = iterator.next();
		const ws = FakeWebSocket.instances[0] as FakeWebSocket;
		ws.dispatch("open");
		await flushMicrotasks();

		ws.dispatch("message", {
			data: JSON.stringify({ type: "text", text: "first" }),
		});
		expect(await firstChunk).toEqual({ value: "first", done: false });

		ws.dispatch("message", {
			data: JSON.stringify({ type: "image", path: "/tmp/ignored.png" }),
		});
		ws.dispatch("message", {
			data: JSON.stringify({ type: "text", text: "second" }),
		});
		expect(await iterator.next()).toEqual({ value: "second", done: false });

		ws.dispatch("message", {
			data: JSON.stringify({ type: "done" }),
		});
		expect(await iterator.next()).toEqual({ value: undefined, done: true });

		bridge.close();
	});

	test("stream() propagates callback failures and fallback runtime errors", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
		const bridge = createTelegramBridge("ws://fake");

		const imageFailure = (async () => {
			for await (const _chunk of bridge.stream("hello", undefined, async () => {
				throw new Error("image callback failed");
			})) {
				// Drain
			}
		})();
		const imageSocket = FakeWebSocket.instances[0] as FakeWebSocket;
		imageSocket.dispatch("open");
		await flushMicrotasks();
		imageSocket.dispatch("message", {
			data: JSON.stringify({ type: "image", path: "/tmp/chart.png" }),
		});
		await expect(imageFailure).rejects.toThrow("image callback failed");

		const errorFailure = (async () => {
			for await (const _chunk of bridge.stream("hello")) {
				// Drain
			}
		})();
		const errorSocket = FakeWebSocket.instances[1] as FakeWebSocket;
		errorSocket.dispatch("open");
		await flushMicrotasks();
		errorSocket.dispatch("message", {
			data: JSON.stringify({ type: "error" }),
		});
		await expect(errorFailure).rejects.toThrow("Unknown error");

		const statusFailure = (async () => {
			for await (const _chunk of bridge.stream("hello")) {
				// Drain
			}
		})();
		const statusSocket = FakeWebSocket.instances[2] as FakeWebSocket;
		statusSocket.dispatch("open");
		await flushMicrotasks();
		statusSocket.dispatch("message", {
			data: JSON.stringify({ type: "status", message: { detail: "bad" } }),
		});
		await expect(statusFailure).rejects.toThrow("Unexpected status event");

		const websocketFailure = (async () => {
			for await (const _chunk of bridge.stream("hello")) {
				// Drain
			}
		})();
		const websocketSocket = FakeWebSocket.instances[3] as FakeWebSocket;
		websocketSocket.dispatch("open");
		await flushMicrotasks();
		websocketSocket.dispatch("error");
		await expect(websocketFailure).rejects.toThrow("WebSocket error");

		bridge.close();
	});

	test("close() closes active sockets", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
		const bridge = createTelegramBridge("ws://fake");

		const response = bridge.send("hello");
		const ws = FakeWebSocket.instances[0] as FakeWebSocket;
		ws.dispatch("open");
		await flushMicrotasks();

		bridge.close();

		expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
		await expect(response).rejects.toThrow("WebSocket closed");
	});
});
