import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRuntime } from "../../src/runtime/server.ts";
import { MockFacade } from "../helpers/mock-facade.ts";

function connectWs(port: number): Promise<WebSocket> {
	return new Promise((resolve) => {
		const ws = new WebSocket(`ws://localhost:${port}`);
		ws.onopen = () => resolve(ws);
	});
}

function collectUntilDone(ws: WebSocket) {
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
		},
	);
}

describe("Runtime server", () => {
	let server: ReturnType<typeof createRuntime>;
	let facade: MockFacade;
	let port: number;

	beforeAll(() => {
		facade = new MockFacade();
		server = createRuntime({ port: 0, facade });
		port = server.port;
	});

	afterAll(() => {
		server.stop();
	});

	test("starts and listens on a port", () => {
		expect(server.port).toBeGreaterThan(0);
	});

	test("accepts WebSocket connections", async () => {
		const ws = await connectWs(port);
		expect(ws.readyState).toBe(WebSocket.OPEN);
		ws.close();
	});

	test("forwards a prompt and receives events", async () => {
		const ws = await connectWs(port);
		const collecting = collectUntilDone(ws);

		ws.send(JSON.stringify({ type: "prompt", prompt: "hello" }));
		const events = await collecting;
		ws.close();

		const textEvents = events.filter((e) => e.type === "text");
		const doneEvents = events.filter((e) => e.type === "done");

		expect(textEvents.length).toBe(1);
		expect(textEvents[0]?.text).toBe("echo: hello");
		expect(doneEvents.length).toBe(1);
	});

	test("resumes session across multiple prompts", async () => {
		const ws = await connectWs(port);

		// Turn 1
		let collecting = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "first" }));
		await collecting;

		// Turn 2 — should pass resume
		collecting = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "second" }));
		await collecting;
		ws.close();

		expect(facade.lastParams?.resume).toBe("mock-session-123");
	});

	test("broadcasts telegram messages to other clients", async () => {
		const tui = await connectWs(port);
		const tg = await connectWs(port);

		const tuiCollecting = collectUntilDone(tui);
		const tgCollecting = collectUntilDone(tg);

		tg.send(
			JSON.stringify({
				type: "prompt",
				prompt: "hi from telegram",
				source: "telegram",
			}),
		);

		const [tuiEvents, tgEvents] = await Promise.all([
			tuiCollecting,
			tgCollecting,
		]);

		// TUI sees user_prompt + response
		const userPrompt = tuiEvents.find((e) => e.type === "user_prompt");
		expect(userPrompt).toBeDefined();
		expect(userPrompt?.prompt).toBe("hi from telegram");
		expect(userPrompt?.source).toBe("telegram");

		const tuiText = tuiEvents.filter((e) => e.type === "text");
		expect(tuiText.length).toBe(1);

		// Telegram also gets its response
		const tgText = tgEvents.filter((e) => e.type === "text");
		expect(tgText.length).toBe(1);

		tui.close();
		tg.close();
	});

	test("shares session across frontends", async () => {
		const tg = await connectWs(port);

		// TG sends first
		let collecting = collectUntilDone(tg);
		tg.send(
			JSON.stringify({
				type: "prompt",
				prompt: "from tg",
				source: "telegram",
			}),
		);
		await collecting;

		// TUI follows up — should use same session
		const tui = await connectWs(port);
		collecting = collectUntilDone(tui);
		tui.send(JSON.stringify({ type: "prompt", prompt: "from tui" }));
		await collecting;

		expect(facade.lastParams?.resume).toBe("mock-session-123");

		tg.close();
		tui.close();
	});

	test("does not broadcast tui messages to other clients", async () => {
		const observer = await connectWs(port);
		const observerEvents: unknown[] = [];
		observer.onmessage = (msg) => {
			observerEvents.push(JSON.parse(String(msg.data)));
		};

		const tui = await connectWs(port);
		const collecting = collectUntilDone(tui);
		tui.send(JSON.stringify({ type: "prompt", prompt: "tui only" }));
		await collecting;

		await new Promise((r) => setTimeout(r, 50));

		expect(observerEvents.length).toBe(0);

		observer.close();
		tui.close();
	});
});
