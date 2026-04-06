import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRuntime } from "../../src/runtime/server.ts";

describe("Runtime server", () => {
	let server: ReturnType<typeof createRuntime>;
	let port: number;

	beforeAll(() => {
		port = 0; // random available port
		server = createRuntime({ port });
	});

	afterAll(() => {
		server.stop();
	});

	test("starts and listens on a port", () => {
		expect(server.port).toBeGreaterThan(0);
	});

	test("accepts WebSocket connections", async () => {
		const ws = new WebSocket(`ws://localhost:${server.port}`);

		const opened = await new Promise<boolean>((resolve) => {
			ws.onopen = () => resolve(true);
			ws.onerror = () => resolve(false);
		});

		expect(opened).toBe(true);
		ws.close();
	});

	test("resumes session across multiple prompts", async () => {
		const ws = new WebSocket(`ws://localhost:${server.port}`);

		await new Promise<void>((resolve) => {
			ws.onopen = () => resolve();
		});

		// Helper to send a prompt and collect events until done
		function sendAndCollect(prompt: string) {
			return new Promise<Array<{ type: string; [key: string]: unknown }>>(
				(resolve) => {
					const events: Array<{ type: string; [key: string]: unknown }> = [];
					ws.onmessage = (msg) => {
						const event = JSON.parse(String(msg.data));
						events.push(event);
						if (event.type === "done" || event.type === "error") {
							resolve(events);
						}
					};
					ws.send(JSON.stringify({ type: "prompt", prompt }));
				},
			);
		}

		// First turn
		const turn1 = await sendAndCollect("My name is Zephyr. Remember it.");
		const done1 = turn1.find((e) => e.type === "done");
		expect(done1).toBeDefined();
		expect(done1?.sessionId).toBeString();

		// Second turn — should resume and know the name
		const turn2 = await sendAndCollect("What is my name?");
		const done2 = turn2.find((e) => e.type === "done");
		expect(done2).toBeDefined();
		// Same session should be resumed
		expect(done2?.sessionId).toBe(done1?.sessionId);

		const text = turn2
			.filter((e) => e.type === "text")
			.map((e) => e.text)
			.join("");
		expect(text.toLowerCase()).toContain("zephyr");

		ws.close();
	}, 60_000);

	test("forwards a prompt and receives events", async () => {
		const ws = new WebSocket(`ws://localhost:${server.port}`);

		await new Promise<void>((resolve) => {
			ws.onopen = () => resolve();
		});

		const events: unknown[] = [];
		const done = new Promise<void>((resolve) => {
			ws.onmessage = (msg) => {
				const event = JSON.parse(String(msg.data));
				events.push(event);
				if (event.type === "done" || event.type === "error") {
					resolve();
				}
			};
		});

		ws.send(JSON.stringify({ type: "prompt", prompt: "Say ok." }));

		await done;
		ws.close();

		const textEvents = events.filter(
			(e: unknown) => (e as { type: string }).type === "text",
		);
		const doneEvents = events.filter(
			(e: unknown) => (e as { type: string }).type === "done",
		);

		expect(textEvents.length).toBeGreaterThan(0);
		expect(doneEvents.length).toBe(1);
	}, 30_000);
});
