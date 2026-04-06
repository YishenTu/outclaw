import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTelegramBridge } from "../../src/frontend/telegram-bridge.ts";
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

	test("chunks long responses at 4096 chars", () => {
		const bridge = createTelegramBridge(`ws://localhost:${server.port}`);

		const longText = "a".repeat(10000);
		const chunks = bridge.chunk(longText, 4096);

		expect(chunks.length).toBe(3);
		expect(chunks[0]?.length).toBe(4096);
		expect(chunks[1]?.length).toBe(4096);
		expect(chunks[2]?.length).toBe(1808);
		expect(chunks.join("")).toBe(longText);

		bridge.close();
	});
});
