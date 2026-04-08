import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTelegramBridge } from "../../src/frontend/telegram/bridge.ts";
import { createRuntime } from "../../src/runtime/transport/ws-server.ts";
import { MockFacade } from "../helpers/mock-facade.ts";

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
});
