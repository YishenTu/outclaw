import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHeartbeatPrompt } from "../../../src/runtime/heartbeat/create-heartbeat-prompt.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store.ts";
import { createRuntime } from "../../../src/runtime/transport/ws-server.ts";
import { MockFacade } from "../../helpers/mock-facade.ts";

const TEST_DB = join(import.meta.dir, ".tmp-server-test.sqlite");
const IMAGE_TMP = mkdtempSync(join(tmpdir(), "mis-runtime-server-"));

function createTestStore(path: string) {
	return new SessionStore(path, { journalMode: "DELETE" });
}

function createImagePath(name: string): string {
	const path = join(IMAGE_TMP, name);
	writeFileSync(path, "bytes");
	return path;
}

function createTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function connectWs(port: number): Promise<WebSocket> {
	return new Promise((resolve) => {
		const ws = new WebSocket(`ws://localhost:${port}`);
		ws.onopen = () => resolve(ws);
	});
}

function waitForEvent(
	ws: WebSocket,
	predicate: (e: { type: string; [key: string]: unknown }) => boolean,
) {
	return new Promise<{ type: string; [key: string]: unknown }>((resolve) => {
		ws.onmessage = (msg) => {
			const event = JSON.parse(String(msg.data));
			if (predicate(event)) resolve(event);
		};
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

function collectMatchingEvents(
	ws: WebSocket,
	predicate: (event: { type: string; [key: string]: unknown }) => boolean,
	count: number,
) {
	return new Promise<Array<{ type: string; [key: string]: unknown }>>(
		(resolve) => {
			const events: Array<{ type: string; [key: string]: unknown }> = [];
			ws.onmessage = (msg) => {
				const event = JSON.parse(String(msg.data));
				if (!predicate(event)) {
					return;
				}
				events.push(event);
				if (events.length === count) {
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

	test("returns a plain HTTP response for non-websocket requests", async () => {
		const response = await fetch(`http://127.0.0.1:${port}/`);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("outclaw runtime");
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

	test("forwards image events over websocket", async () => {
		const imageFacade = new MockFacade();
		const imagePath = createImagePath("server-chart.png");
		imageFacade.textChunks = [`Saved chart to ${imagePath}`];
		const imageServer = createRuntime({ port: 0, facade: imageFacade });

		const ws = await connectWs(imageServer.port);
		const collecting = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "plot" }));
		const events = await collecting;
		ws.close();

		expect(events.find((event) => event.type === "image")).toEqual({
			type: "image",
			path: imagePath,
		});

		imageServer.stop();
	});

	test("passes cwd to facade", async () => {
		const cwdFacade = new MockFacade();
		const cwdServer = createRuntime({
			port: 0,
			facade: cwdFacade,
			cwd: "/tmp/test-outclaw",
		});

		const ws = await connectWs(cwdServer.port);
		const collecting = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "hi" }));
		await collecting;
		ws.close();

		expect(cwdFacade.lastParams?.cwd).toBe("/tmp/test-outclaw");

		cwdServer.stop();
	});

	test("cwd is undefined when not provided", async () => {
		const ws = await connectWs(port);
		const collecting = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "hi" }));
		await collecting;
		ws.close();

		expect(facade.lastParams?.cwd).toBeUndefined();
	});

	test("/new clears session and notifies sender", async () => {
		// Use a fresh runtime so activeSessionId starts undefined
		const newFacade = new MockFacade();
		const newServer = createRuntime({ port: 0, facade: newFacade });
		const ws = await connectWs(newServer.port);

		// Two prompts to establish a resumed session
		let collecting = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "first" }));
		await collecting;

		collecting = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "second" }));
		await collecting;

		expect(newFacade.lastParams?.resume).toBe("mock-session-123");

		// Send /new command
		ws.send(JSON.stringify({ type: "command", command: "/new" }));
		const event = await waitForEvent(ws, (e) => e.type === "session_cleared");

		expect(event.type).toBe("session_cleared");

		// Next prompt should NOT have resume
		collecting = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "fresh" }));
		await collecting;
		ws.close();

		expect(newFacade.lastParams?.resume).toBeUndefined();

		newServer.stop();
	});

	test("/new broadcasts session clear to other clients", async () => {
		const sharedFacade = new MockFacade();
		const sharedServer = createRuntime({ port: 0, facade: sharedFacade });
		const sender = await connectWs(sharedServer.port);
		const observer = await connectWs(sharedServer.port);

		const collecting = collectUntilDone(sender);
		sender.send(JSON.stringify({ type: "prompt", prompt: "first" }));
		await collecting;

		const senderEvents = collectMatchingEvents(
			sender,
			(event) => event.type === "session_cleared",
			1,
		);
		const observerEvents = collectMatchingEvents(
			observer,
			(event) => event.type === "session_cleared",
			1,
		);
		sender.send(JSON.stringify({ type: "command", command: "/new" }));

		await Promise.all([senderEvents, observerEvents]);

		sender.close();
		observer.close();
		sharedServer.stop();
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
		const observerEvents: Array<{ type: string }> = [];
		observer.onmessage = (msg) => {
			const event = JSON.parse(String(msg.data));
			// Ignore history_replay and runtime_status from connect
			if (event.type !== "history_replay" && event.type !== "runtime_status") {
				observerEvents.push(event);
			}
		};

		const tui = await connectWs(port);
		// Wait briefly for any history_replay to settle
		await new Promise((r) => setTimeout(r, 50));
		const collecting = collectUntilDone(tui);
		tui.send(JSON.stringify({ type: "prompt", prompt: "tui only" }));
		await collecting;

		await new Promise((r) => setTimeout(r, 50));

		expect(observerEvents.length).toBe(0);

		observer.close();
		tui.close();
	});

	test("queues concurrent prompts and processes in order", async () => {
		const queueFacade = new MockFacade();
		queueFacade.delayMs = 30;
		const queueServer = createRuntime({ port: 0, facade: queueFacade });

		const ws = await connectWs(queueServer.port);

		// Fire 3 prompts without waiting
		const allEvents: Array<{ type: string; [key: string]: unknown }> = [];
		let doneCount = 0;
		const allDone = new Promise<void>((resolve) => {
			ws.onmessage = (msg) => {
				const event = JSON.parse(String(msg.data));
				allEvents.push(event);
				if (event.type === "done") {
					doneCount++;
					if (doneCount === 3) resolve();
				}
			};
		});

		ws.send(JSON.stringify({ type: "prompt", prompt: "A" }));
		ws.send(JSON.stringify({ type: "prompt", prompt: "B" }));
		ws.send(JSON.stringify({ type: "prompt", prompt: "C" }));

		await allDone;
		ws.close();

		// All 3 should complete
		expect(doneCount).toBe(3);

		// Should be processed in order
		expect(queueFacade.callOrder).toEqual(["A", "B", "C"]);

		// Events must be strictly sequential: text A, done A, text B, done B, text C, done C
		const significant = allEvents.filter(
			(e) => e.type === "text" || e.type === "done",
		);
		expect(significant.map((e) => e.type)).toEqual([
			"text",
			"done",
			"text",
			"done",
			"text",
			"done",
		]);

		queueServer.stop();
	});

	test("stop() aborts the active work and drops queued prompts before closing client streams", async () => {
		const stopFacade = new MockFacade();
		stopFacade.delayMs = 40;
		const stopServer = createRuntime({ port: 0, facade: stopFacade });
		const ws = await connectWs(stopServer.port);

		let doneCount = 0;
		ws.onmessage = (msg) => {
			const event = JSON.parse(String(msg.data)) as { type: string };
			if (event.type === "done") {
				doneCount++;
			}
		};

		ws.send(JSON.stringify({ type: "prompt", prompt: "first" }));
		ws.send(JSON.stringify({ type: "prompt", prompt: "second" }));
		await new Promise((r) => setTimeout(r, 10));

		await stopServer.stop();
		await new Promise((r) => setTimeout(r, 10));

		const firstCall = stopFacade.allParams.find((p) => p.prompt === "first");
		expect(firstCall?.abortController?.signal.aborted).toBe(true);
		expect(stopFacade.callOrder).toEqual(["first"]);
		expect(doneCount).toBe(1);

		ws.close();
	});

	test("/model switches model and confirms", async () => {
		const modelFacade = new MockFacade();
		const modelServer = createRuntime({ port: 0, facade: modelFacade });
		const ws = await connectWs(modelServer.port);

		// Switch to haiku
		ws.send(JSON.stringify({ type: "command", command: "/model haiku" }));
		const switchEvent = await waitForEvent(
			ws,
			(e) => e.type === "model_changed",
		);
		expect(switchEvent.type).toBe("model_changed");
		expect(switchEvent.model).toBe("haiku");

		// Next prompt should use haiku
		const collecting = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "hi" }));
		await collecting;

		expect(modelFacade.lastParams?.model).toBe("haiku");

		ws.close();
		modelServer.stop();
	});

	test("/model broadcasts changes to other clients", async () => {
		const sharedServer = createRuntime({ port: 0, facade: new MockFacade() });
		const sender = await connectWs(sharedServer.port);
		const observer = await connectWs(sharedServer.port);

		const senderEvents = collectMatchingEvents(
			sender,
			(event) => event.type === "model_changed",
			1,
		);
		const observerEvents = collectMatchingEvents(
			observer,
			(event) => event.type === "model_changed",
			1,
		);

		sender.send(JSON.stringify({ type: "command", command: "/model haiku" }));

		const [senderResult, observerResult] = await Promise.all([
			senderEvents,
			observerEvents,
		]);
		expect(senderResult[0]?.model).toBe("haiku");
		expect(observerResult[0]?.model).toBe("haiku");

		sender.close();
		observer.close();
		sharedServer.stop();
	});

	test("/model with no arg returns current model", async () => {
		const ws = await connectWs(port);
		ws.send(JSON.stringify({ type: "command", command: "/model" }));
		const event = await waitForEvent(ws, (e) => e.type === "model_changed");

		expect(event.model).toBe("opus");
		ws.close();
	});

	test("/opus shorthand switches model", async () => {
		const shortFacade = new MockFacade();
		const shortServer = createRuntime({ port: 0, facade: shortFacade });
		const ws = await connectWs(shortServer.port);

		ws.send(JSON.stringify({ type: "command", command: "/opus" }));
		const event = await waitForEvent(ws, (e) => e.type === "model_changed");

		expect(event.type).toBe("model_changed");
		expect(event.model).toBe("opus");

		const collecting = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "hi" }));
		await collecting;

		expect(shortFacade.lastParams?.model).toBe("claude-opus-4-7[1m]");

		ws.close();
		shortServer.stop();
	});

	test("/model rejects invalid alias", async () => {
		const ws = await connectWs(port);
		ws.send(JSON.stringify({ type: "command", command: "/model gpt-5" }));
		const event = await waitForEvent(ws, (e) => e.type === "error");

		expect(event.type).toBe("error");
		ws.close();
	});

	test("/thinking switches effort and confirms", async () => {
		const effortFacade = new MockFacade();
		const effortServer = createRuntime({ port: 0, facade: effortFacade });
		const ws = await connectWs(effortServer.port);

		ws.send(JSON.stringify({ type: "command", command: "/thinking max" }));
		const event = await waitForEvent(ws, (e) => e.type === "effort_changed");
		expect(event.type).toBe("effort_changed");
		expect(event.effort).toBe("max");

		const collecting = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "hi" }));
		await collecting;

		expect(effortFacade.lastParams?.effort).toBe("max");

		ws.close();
		effortServer.stop();
	});

	test("/thinking broadcasts changes to other clients", async () => {
		const sharedServer = createRuntime({ port: 0, facade: new MockFacade() });
		const sender = await connectWs(sharedServer.port);
		const observer = await connectWs(sharedServer.port);

		const senderEvents = collectMatchingEvents(
			sender,
			(event) => event.type === "effort_changed",
			1,
		);
		const observerEvents = collectMatchingEvents(
			observer,
			(event) => event.type === "effort_changed",
			1,
		);

		sender.send(JSON.stringify({ type: "command", command: "/thinking max" }));

		const [senderResult, observerResult] = await Promise.all([
			senderEvents,
			observerEvents,
		]);
		expect(senderResult[0]?.effort).toBe("max");
		expect(observerResult[0]?.effort).toBe("max");

		sender.close();
		observer.close();
		sharedServer.stop();
	});

	test("/thinking with no arg returns current effort", async () => {
		const ws = await connectWs(port);
		ws.send(JSON.stringify({ type: "command", command: "/thinking" }));
		const event = await waitForEvent(ws, (e) => e.type === "effort_changed");

		expect(event.effort).toBe("high");
		ws.close();
	});

	test("/thinking rejects invalid effort", async () => {
		const ws = await connectWs(port);
		ws.send(JSON.stringify({ type: "command", command: "/thinking turbo" }));
		const event = await waitForEvent(ws, (e) => e.type === "error");

		expect(event.type).toBe("error");
		ws.close();
	});

	test("/session shows current session info", async () => {
		const dbPath = `${TEST_DB}-info`;
		const store = createTestStore(dbPath);
		const sessFacade = new MockFacade();
		const sessServer = createRuntime({
			port: 0,
			facade: sessFacade,
			store,
		});
		const ws = await connectWs(sessServer.port);

		// Create a session first
		const collecting = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "Hello world" }));
		await collecting;

		ws.send(JSON.stringify({ type: "command", command: "/session" }));
		const event = await waitForEvent(ws, (e) => e.type === "session_menu");

		expect(event.type).toBe("session_menu");
		const sessions = event.sessions as Array<{
			sdkSessionId: string;
			title: string;
		}>;
		expect(sessions[0]?.sdkSessionId).toBe("mock-session-123");
		expect(sessions[0]?.title).toBe("Hello world");

		ws.close();
		sessServer.stop();
		store.close();
		if (existsSync(dbPath)) rmSync(dbPath);
	});

	test("/session list returns sessions", async () => {
		const dbPath = `${TEST_DB}-list`;
		const store = createTestStore(dbPath);
		store.upsert({
			providerId: "mock",
			sdkSessionId: "sdk-aaa",
			title: "First chat",
			model: "sonnet",
		});
		store.upsert({
			providerId: "mock",
			sdkSessionId: "sdk-bbb",
			title: "Second chat",
			model: "opus",
		});

		const sessServer = createRuntime({
			port: 0,
			facade: new MockFacade(),
			store,
		});
		const ws = await connectWs(sessServer.port);

		ws.send(JSON.stringify({ type: "command", command: "/session list" }));
		const event = await waitForEvent(ws, (e) => e.type === "session_list");

		expect(event.type).toBe("session_list");
		expect((event.sessions as unknown[])?.length).toBe(2);

		ws.close();
		sessServer.stop();
		store.close();
		if (existsSync(dbPath)) rmSync(dbPath);
	});

	test("/session <id> switches to session", async () => {
		const dbPath = `${TEST_DB}-switch`;
		const store = createTestStore(dbPath);
		store.upsert({
			providerId: "mock",
			sdkSessionId: "sdk-target-abc",
			title: "Target session",
			model: "haiku",
		});

		const sessFacade = new MockFacade();
		const sessServer = createRuntime({
			port: 0,
			facade: sessFacade,
			store,
		});
		const ws = await connectWs(sessServer.port);

		ws.send(
			JSON.stringify({ type: "command", command: "/session sdk-target" }),
		);
		const event = await waitForEvent(ws, (e) => e.type === "session_switched");

		expect(event.type).toBe("session_switched");
		expect(event.sdkSessionId).toBe("sdk-target-abc");

		// Next prompt should resume this session
		const collecting = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "follow up" }));
		await collecting;

		expect(sessFacade.lastParams?.resume).toBe("sdk-target-abc");
		expect(sessFacade.lastParams?.model).toBe("haiku");

		ws.close();
		sessServer.stop();
		store.close();
		if (existsSync(dbPath)) rmSync(dbPath);
	});

	test("/session switch broadcasts to other clients", async () => {
		const dbPath = `${TEST_DB}-switch-broadcast`;
		const store = createTestStore(dbPath);
		store.upsert({
			providerId: "mock",
			sdkSessionId: "sdk-target-abc",
			title: "Target session",
			model: "haiku",
		});

		const sharedServer = createRuntime({
			port: 0,
			facade: new MockFacade(),
			store,
		});
		const sender = await connectWs(sharedServer.port);
		const observer = await connectWs(sharedServer.port);

		const senderEvents = collectMatchingEvents(
			sender,
			(event) => event.type === "session_switched",
			1,
		);
		const observerEvents = collectMatchingEvents(
			observer,
			(event) => event.type === "session_switched",
			1,
		);

		sender.send(
			JSON.stringify({
				type: "command",
				command: "/session sdk-target",
			}),
		);

		const [senderResult, observerResult] = await Promise.all([
			senderEvents,
			observerEvents,
		]);
		expect(senderResult[0]?.sdkSessionId).toBe("sdk-target-abc");
		expect(observerResult[0]?.sdkSessionId).toBe("sdk-target-abc");

		sender.close();
		observer.close();
		sharedServer.stop();
		store.close();
		if (existsSync(dbPath)) rmSync(dbPath);
	});

	test("session switch replays history to all connected clients", async () => {
		const dbPath = `${TEST_DB}-switch-history`;
		const store = createTestStore(dbPath);
		store.upsert({
			providerId: "mock",
			sdkSessionId: "sdk-target-abc",
			title: "Target session",
			model: "haiku",
		});
		const facade = new MockFacade();
		facade.historyMessages = [
			{ kind: "chat", role: "user", content: "history for sdk-target-abc" },
		];

		const sharedServer = createRuntime({
			port: 0,
			facade,
			store,
		});
		const sender = await connectWs(sharedServer.port);
		const observer = await connectWs(sharedServer.port);

		const senderEvents = collectMatchingEvents(
			sender,
			(event) =>
				event.type === "session_switched" || event.type === "history_replay",
			2,
		);
		const observerEvents = collectMatchingEvents(
			observer,
			(event) =>
				event.type === "session_switched" || event.type === "history_replay",
			2,
		);

		sender.send(
			JSON.stringify({
				type: "command",
				command: "/session sdk-target",
			}),
		);

		const [senderResult, observerResult] = await Promise.all([
			senderEvents,
			observerEvents,
		]);
		expect(senderResult.map((event) => event.type)).toContain("history_replay");
		expect(observerResult.map((event) => event.type)).toContain(
			"history_replay",
		);

		sender.close();
		observer.close();
		sharedServer.stop();
		store.close();
		if (existsSync(dbPath)) rmSync(dbPath);
	});

	test("/status returns model, effort, session, and usage", async () => {
		const ws = await connectWs(port);

		// Send a prompt first to populate usage
		const collecting = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "hi" }));
		await collecting;

		ws.send(JSON.stringify({ type: "command", command: "/status" }));
		const event = await waitForEvent(ws, (e) => e.type === "runtime_status");

		expect(event.type).toBe("runtime_status");
		expect(event.model).toBe("opus");
		expect(event.effort).toBe("high");
		expect(event.sessionId).toBe("mock-session-123");

		ws.close();
	});

	test("wires the heartbeat scheduler through createRuntime", async () => {
		const promptHomeDir = createTempDir("mis-runtime-heartbeat-");
		writeFileSync(join(promptHomeDir, "HEARTBEAT.md"), "check tasks");
		const heartbeatFacade = new MockFacade();
		const heartbeatServer = createRuntime({
			port: 0,
			facade: heartbeatFacade,
			promptHomeDir,
			heartbeat: {
				intervalMinutes: 0.001,
				deferMinutes: 0,
			},
		});
		heartbeatServer.setHeartbeatResultHandler(async () => undefined);

		try {
			const ws = await connectWs(heartbeatServer.port);
			const collecting = collectUntilDone(ws);
			ws.send(JSON.stringify({ type: "prompt", prompt: "start session" }));
			await collecting;

			const heartbeatPrompt = await Promise.race([
				waitForEvent(
					ws,
					(event) =>
						event.type === "user_prompt" &&
						event.prompt === createHeartbeatPrompt(promptHomeDir),
				),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error("Timed out waiting for heartbeat")),
						1000,
					),
				),
			]);

			expect(heartbeatPrompt.type).toBe("user_prompt");

			ws.close();
		} finally {
			await heartbeatServer.stop();
			rmSync(promptHomeDir, { force: true, recursive: true });
		}
	});

	test("broadcasts heartbeatDeferred when a tick is deferred", async () => {
		const promptHomeDir = createTempDir("mis-runtime-heartbeat-deferred-");
		writeFileSync(join(promptHomeDir, "HEARTBEAT.md"), "check tasks");
		const heartbeatFacade = new MockFacade();
		const heartbeatServer = createRuntime({
			port: 0,
			facade: heartbeatFacade,
			promptHomeDir,
			heartbeat: {
				intervalMinutes: 0.001,
				deferMinutes: 1,
			},
		});

		try {
			const ws = await connectWs(heartbeatServer.port);
			const collecting = collectUntilDone(ws);
			ws.send(JSON.stringify({ type: "prompt", prompt: "start session" }));
			await collecting;

			const statusUpdate = await Promise.race([
				waitForEvent(
					ws,
					(event) =>
						event.type === "runtime_status" && event.heartbeatDeferred === true,
				),
				new Promise<never>((_, reject) =>
					setTimeout(
						() =>
							reject(
								new Error(
									"Timed out waiting for deferred heartbeat status update",
								),
							),
						500,
					),
				),
			]);

			expect(statusUpdate.type).toBe("runtime_status");
			expect(statusUpdate.heartbeatDeferred).toBe(true);

			ws.close();
		} finally {
			await heartbeatServer.stop();
			rmSync(promptHomeDir, { force: true, recursive: true });
		}
	});

	test("wires the cron scheduler through createRuntime", async () => {
		const promptHomeDir = createTempDir("mis-runtime-cron-prompt-");
		const cronDir = createTempDir("mis-runtime-cron-dir-");
		writeFileSync(
			join(cronDir, "job.yaml"),
			[
				"name: runtime-cron",
				'schedule: "* * * * * *"',
				"prompt: say hello",
			].join("\n"),
		);

		const cronFacade = new MockFacade();
		const cronServer = createRuntime({
			port: 0,
			facade: cronFacade,
			promptHomeDir,
			cronDir,
		});
		cronServer.setCronResultHandler(async () => undefined);

		try {
			const ws = await connectWs(cronServer.port);
			const cronResult = await Promise.race([
				waitForEvent(
					ws,
					(event) =>
						event.type === "cron_result" && event.jobName === "runtime-cron",
				),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error("Timed out waiting for cron result")),
						2000,
					),
				),
			]);

			expect(cronResult).toEqual({
				type: "cron_result",
				jobName: "runtime-cron",
				text: "echo: say hello",
			});
			expect(cronFacade.lastParams?.prompt).toBe("say hello");
			expect(cronFacade.lastParams?.model).toBe("claude-opus-4-7[1m]");

			ws.close();
		} finally {
			await cronServer.stop();
			rmSync(promptHomeDir, { force: true, recursive: true });
			rmSync(cronDir, { force: true, recursive: true });
		}
	});
});
