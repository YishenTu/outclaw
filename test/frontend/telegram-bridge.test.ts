import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTelegramBridge } from "../../src/frontend/telegram/bridge.ts";
import { createRuntime } from "../../src/runtime/server.ts";
import { MockFacade } from "../helpers/mock-facade.ts";

describe("Telegram bridge", () => {
	let server: ReturnType<typeof createRuntime>;

	beforeAll(() => {
		server = createRuntime({ port: 0, facade: new MockFacade() });
	});

	afterAll(() => {
		server.stop();
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

	test("sendCommandAndWait() returns command responses", async () => {
		const bridge = createTelegramBridge(`ws://localhost:${server.port}`);
		const event = await bridge.sendCommandAndWait("/model");

		expect(event.type).toBe("model_changed");
		expect(event.model).toBe("opus");

		bridge.close();
	});
});
