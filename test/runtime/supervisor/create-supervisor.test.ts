import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FacadeEvent, RunParams } from "../../../src/common/protocol.ts";
import { createAgentRuntime } from "../../../src/runtime/application/create-agent-runtime.ts";
import { createBrowserApi } from "../../../src/runtime/browser/create-browser-api.ts";
import {
	ChatCodingLinkStore,
	CODING_STORAGE_OWNER_ID,
	CodingRepositoryStore,
	CodingSessionEventHub,
	CodingSessionStore,
	createCodingService,
} from "../../../src/runtime/coding/index.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store/session-store.ts";
import { createSupervisor } from "../../../src/runtime/supervisor/create-supervisor.ts";
import { MockFacade } from "../../helpers/mock-facade.ts";

class SessionInitializingMockFacade extends MockFacade {
	override async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		yield {
			type: "session_initialized",
			sessionId: "mock-session-123",
		};
		yield* super.run(params);
	}
}

function connectWs(port: number, agent?: string): Promise<WebSocket> {
	return new Promise((resolve) => {
		const query = agent ? `?agent=${encodeURIComponent(agent)}` : "";
		const ws = new WebSocket(`ws://localhost:${port}${query}`);
		ws.onopen = () => resolve(ws);
	});
}

function connectBrowserWs(port: number, agent?: string): Promise<WebSocket> {
	return new Promise((resolve) => {
		const url = new URL(`ws://localhost:${port}`);
		url.searchParams.set("client", "browser");
		if (agent) {
			url.searchParams.set("agent", agent);
		}
		const ws = new WebSocket(url);
		ws.onopen = () => resolve(ws);
	});
}

function connectBrowserWsWithCookie(
	port: number,
	cookieHeader: string,
): Promise<WebSocket> {
	return new Promise((resolve) => {
		const url = new URL(`ws://localhost:${port}`);
		url.searchParams.set("client", "browser");
		// Bun's WebSocket constructor honours the headers option; this is how the
		// real browser sends the cookie back on reconnect.
		const ws = new WebSocket(url, {
			headers: { cookie: cookieHeader },
		} as unknown as undefined);
		ws.onopen = () => resolve(ws);
	});
}

function connectBrowserRuntimeWs(
	port: number,
	agent?: string,
): Promise<WebSocket> {
	return new Promise((resolve) => {
		const url = new URL(`ws://localhost:${port}/ws`);
		url.searchParams.set("client", "browser");
		if (agent) {
			url.searchParams.set("agent", agent);
		}
		const ws = new WebSocket(url);
		ws.onopen = () => resolve(ws);
	});
}

function connectTelegramWs(
	port: number,
	params: {
		agent?: string;
		botId: string;
		telegramUserId: number;
	},
): Promise<WebSocket> {
	return new Promise((resolve) => {
		const url = new URL(`ws://localhost:${port}`);
		url.searchParams.set("client", "telegram");
		url.searchParams.set("telegramBotId", params.botId);
		url.searchParams.set("telegramUserId", String(params.telegramUserId));
		if (params.agent) {
			url.searchParams.set("agent", params.agent);
		}
		const ws = new WebSocket(url);
		ws.onopen = () => resolve(ws);
	});
}

function connectControlWs(port: number): Promise<WebSocket> {
	return new Promise((resolve) => {
		const url = new URL(`ws://localhost:${port}`);
		url.searchParams.set("client", "control");
		const ws = new WebSocket(url);
		ws.onopen = () => resolve(ws);
	});
}

function waitForEvent(
	ws: WebSocket,
	predicate: (event: { type: string; [key: string]: unknown }) => boolean,
) {
	return new Promise<{ type: string; [key: string]: unknown }>((resolve) => {
		const listener = (message: MessageEvent) => {
			const event = JSON.parse(String(message.data));
			if (!predicate(event)) {
				return;
			}
			ws.removeEventListener("message", listener);
			resolve(event);
		};
		ws.addEventListener("message", listener);
	});
}

function collectFor(
	ws: WebSocket,
	durationMs: number,
): Promise<Array<{ type: string; [key: string]: unknown }>> {
	return new Promise((resolve) => {
		const events: Array<{ type: string; [key: string]: unknown }> = [];
		const listener = (message: MessageEvent) => {
			events.push(JSON.parse(String(message.data)));
		};
		ws.addEventListener("message", listener);
		setTimeout(() => {
			ws.removeEventListener("message", listener);
			resolve(events);
		}, durationMs);
	});
}

function collectUntilDone(ws: WebSocket) {
	return new Promise<Array<{ type: string; [key: string]: unknown }>>(
		(resolve) => {
			const events: Array<{ type: string; [key: string]: unknown }> = [];
			const listener = (message: MessageEvent) => {
				const event = JSON.parse(String(message.data));
				events.push(event);
				if (event.type === "done" || event.type === "error") {
					ws.removeEventListener("message", listener);
					resolve(events);
				}
			};
			ws.addEventListener("message", listener);
		},
	);
}

function createCronAgentHome(agentId: string, prompt: string) {
	const dir = mkdtempSync(join(tmpdir(), "outclaw-supervisor-cron-"));
	mkdirSync(join(dir, "cron"), { recursive: true });
	writeFileSync(join(dir, ".agent-id"), `${agentId}\n`);
	writeFileSync(
		join(dir, "cron", "daily.yaml"),
		`
name: daily
schedule: "* * * * *"
model: opus
prompt: ${prompt}
`.trim(),
	);
	return dir;
}

function createAgentHome(agentId: string) {
	const dir = mkdtempSync(join(tmpdir(), "outclaw-supervisor-agent-"));
	writeFileSync(join(dir, ".agent-id"), `${agentId}\n`);
	return dir;
}

class BlockingFacade extends MockFacade {
	private releaseRun: (() => void) | undefined;
	private resolveStarted: (() => void) | undefined;
	readonly started = new Promise<void>((resolve) => {
		this.resolveStarted = resolve;
	});

	release() {
		this.releaseRun?.();
	}

	override async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		this.lastParams = params;
		this.allParams.push({ ...params });
		this.callCount++;
		this.callOrder.push(params.prompt);
		this.resolveStarted?.();

		await new Promise<void>((resolve) => {
			this.releaseRun = resolve;
			params.abortController?.signal.addEventListener(
				"abort",
				() => resolve(),
				{
					once: true,
				},
			);
		});

		if (params.abortController?.signal.aborted) {
			yield { type: "error", message: "aborted" };
			return;
		}

		if (this.textChunks) {
			for (const text of this.textChunks) {
				yield { type: "text", text };
			}
		} else {
			yield { type: "text", text: `echo: ${params.prompt}` };
		}
		yield {
			type: "done",
			sessionId: "blocking-session-123",
			durationMs: 1,
			costUsd: 0,
		};
	}
}

async function waitForCondition(
	check: () => boolean | Promise<boolean>,
	timeoutMs = 500,
) {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (await check()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	throw new Error("Timed out waiting for condition");
}

describe("createSupervisor", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
	});

	test("binds clients to the requested agent on connect", async () => {
		const raillyFacade = new MockFacade();
		raillyFacade.textChunks = ["railly"];
		const mimiFacade = new MockFacade();
		mimiFacade.textChunks = ["mimi"];
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: raillyFacade,
				}),
				createAgentRuntime({
					agentId: "agent-mimi",
					name: "mimi",
					facade: mimiFacade,
				}),
			],
		});
		cleanup = () => supervisor.stop();

		const ws = await connectWs(supervisor.port, "mimi");
		expect(
			await waitForEvent(ws, (event) => event.type === "agent_switched"),
		).toEqual({
			type: "agent_switched",
			agentId: "agent-mimi",
			name: "mimi",
		});
		await waitForEvent(ws, (event) => event.type === "runtime_status");

		const events = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "hello" }));
		expect((await events).find((event) => event.type === "text")?.text).toBe(
			"mimi",
		);

		ws.close();
	});

	test("accepts browser runtime websocket clients on the /ws path", async () => {
		const raillyFacade = new MockFacade();
		raillyFacade.textChunks = ["from browser ws"];
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: raillyFacade,
				}),
			],
		});
		cleanup = () => supervisor.stop();

		const ws = await connectBrowserRuntimeWs(supervisor.port, "railly");
		expect(
			await waitForEvent(ws, (event) => event.type === "runtime_status"),
		).toMatchObject({
			type: "runtime_status",
			agentName: "railly",
		});

		const events = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "hello from browser" }));

		expect((await events).find((event) => event.type === "text")?.text).toBe(
			"from browser ws",
		);
		expect(raillyFacade.lastParams?.prompt).toBe("hello from browser");

		ws.close();
	});

	test("notifies browser clients when another agent changes persisted session data", async () => {
		const dbDir = mkdtempSync(join(tmpdir(), "outclaw-supervisor-sessions-"));
		const dbPath = join(dbDir, "sessions.sqlite");
		const raillyStore = new SessionStore(dbPath, { agentId: "agent-railly" });
		const mimiStore = new SessionStore(dbPath, { agentId: "agent-mimi" });
		const raillyFacade = new MockFacade();
		const mimiFacade = new MockFacade();
		mimiFacade.textChunks = ["mimi response"];
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: raillyFacade,
					store: raillyStore,
				}),
				createAgentRuntime({
					agentId: "agent-mimi",
					name: "mimi",
					facade: mimiFacade,
					store: mimiStore,
				}),
			],
		});
		cleanup = async () => {
			await supervisor.stop();
			raillyStore.close();
			mimiStore.close();
			rmSync(dbDir, { recursive: true, force: true });
		};

		const browser = await connectBrowserRuntimeWs(supervisor.port, "railly");
		await waitForEvent(browser, (event) => event.type === "runtime_status");
		const tui = await connectWs(supervisor.port, "mimi");
		await waitForEvent(tui, (event) => event.type === "runtime_status");

		const invalidated = waitForEvent(
			browser,
			(event) => event.type === "browser_agents_invalidated",
		);
		tui.send(JSON.stringify({ type: "prompt", prompt: "hello from mimi" }));

		expect(await invalidated).toEqual({
			type: "browser_agents_invalidated",
			agentId: "agent-mimi",
		});

		browser.close();
		tui.close();
	});

	test("session switches update browser active-session markers without invalidating agent lists", async () => {
		const dbDir = mkdtempSync(join(tmpdir(), "outclaw-supervisor-switch-"));
		const dbPath = join(dbDir, "sessions.sqlite");
		const raillyStore = new SessionStore(dbPath, { agentId: "agent-railly" });
		raillyStore.upsert({
			providerId: "mock",
			sdkSessionId: "sdk-target-abc",
			title: "Target session",
			model: "haiku",
		});
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
					store: raillyStore,
				}),
			],
		});
		cleanup = async () => {
			await supervisor.stop();
			raillyStore.close();
			rmSync(dbDir, { recursive: true, force: true });
		};

		const browser = await connectBrowserRuntimeWs(supervisor.port, "railly");
		await waitForEvent(browser, (event) => event.type === "runtime_status");

		const events = collectFor(browser, 150);
		browser.send(
			JSON.stringify({ type: "command", command: "/session sdk-target" }),
		);

		const observed = await events;
		expect(observed).toContainEqual({
			type: "browser_agent_active_session_changed",
			agentId: "agent-railly",
			activeSession: {
				providerId: "mock",
				sdkSessionId: "sdk-target-abc",
			},
		});
		expect(observed).toContainEqual({
			type: "session_switched",
			sdkSessionId: "sdk-target-abc",
			title: "Target session",
			providerId: "mock",
		});
		expect(
			observed.filter((event) => event.type === "browser_agents_invalidated"),
		).toEqual([]);

		browser.close();
	});

	test("does not leak events between clients bound to different agents", async () => {
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
				createAgentRuntime({
					agentId: "agent-mimi",
					name: "mimi",
					facade: new MockFacade(),
				}),
			],
		});
		cleanup = () => supervisor.stop();

		const raillyWs = await connectWs(supervisor.port, "railly");
		await waitForEvent(raillyWs, (event) => event.type === "runtime_status");
		const mimiWs = await connectWs(supervisor.port, "mimi");
		await waitForEvent(mimiWs, (event) => event.type === "runtime_status");

		const mimiEvents = collectFor(mimiWs, 150);
		const raillyEvents = collectUntilDone(raillyWs);
		raillyWs.send(JSON.stringify({ type: "prompt", prompt: "hello railly" }));

		await raillyEvents;
		expect(
			(await mimiEvents).filter((event) =>
				["user_prompt", "text", "done", "history_replay"].includes(event.type),
			),
		).toEqual([]);

		raillyWs.close();
		mimiWs.close();
	});

	test("switches the current client to another agent via /agent", async () => {
		const raillyFacade = new MockFacade();
		raillyFacade.textChunks = ["from railly"];
		const mimiFacade = new MockFacade();
		mimiFacade.textChunks = ["from mimi"];
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: raillyFacade,
				}),
				createAgentRuntime({
					agentId: "agent-mimi",
					name: "mimi",
					facade: mimiFacade,
				}),
			],
		});
		cleanup = () => supervisor.stop();

		const ws = await connectWs(supervisor.port, "railly");
		await waitForEvent(ws, (event) => event.type === "runtime_status");

		ws.send(JSON.stringify({ type: "command", command: "/agent mimi" }));
		expect(
			await waitForEvent(ws, (event) => event.type === "agent_switched"),
		).toEqual({
			type: "agent_switched",
			agentId: "agent-mimi",
			name: "mimi",
		});
		await waitForEvent(ws, (event) => event.type === "runtime_status");

		const events = collectUntilDone(ws);
		ws.send(JSON.stringify({ type: "prompt", prompt: "hello after switch" }));
		expect((await events).find((event) => event.type === "text")?.text).toBe(
			"from mimi",
		);

		ws.close();
	});

	test("each interactive client binds to its own agent independently", async () => {
		// Multi-browser support: two browsers can hold different agents at the same
		// time, and a TUI switching agents must not drag any browser along.
		const alphaFacade = new MockFacade();
		alphaFacade.textChunks = ["from alpha"];
		const zetaFacade = new MockFacade();
		zetaFacade.textChunks = ["from zeta"];
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-alpha",
					name: "alpha",
					facade: alphaFacade,
				}),
				createAgentRuntime({
					agentId: "agent-zeta",
					name: "zeta",
					facade: zetaFacade,
				}),
			],
		});
		cleanup = () => supervisor.stop();

		const browserAlpha = await connectBrowserWs(supervisor.port, "alpha");
		expect(
			await waitForEvent(
				browserAlpha,
				(event) => event.type === "agent_switched",
			),
		).toEqual({
			type: "agent_switched",
			agentId: "agent-alpha",
			name: "alpha",
		});
		await waitForEvent(
			browserAlpha,
			(event) => event.type === "runtime_status",
		);

		const browserZeta = await connectBrowserWs(supervisor.port, "zeta");
		expect(
			await waitForEvent(
				browserZeta,
				(event) => event.type === "agent_switched",
			),
		).toEqual({
			type: "agent_switched",
			agentId: "agent-zeta",
			name: "zeta",
		});
		await waitForEvent(browserZeta, (event) => event.type === "runtime_status");

		const tui = await connectWs(supervisor.port, "alpha");
		await waitForEvent(tui, (event) => event.type === "runtime_status");

		// TUI switches to zeta. Neither browser should observe an agent_switched
		// event — they're independent connections, each free to stay on their own
		// agent.
		const tuiSwitched = waitForEvent(
			tui,
			(event) =>
				event.type === "agent_switched" && event.agentId === "agent-zeta",
		);
		const browserAlphaUnexpected = collectFor(browserAlpha, 200);
		const browserZetaUnexpected = collectFor(browserZeta, 200);
		tui.send(JSON.stringify({ type: "command", command: "/agent zeta" }));
		await tuiSwitched;

		expect(
			(await browserAlphaUnexpected).filter(
				(event) => event.type === "agent_switched",
			),
		).toEqual([]);
		expect(
			(await browserZetaUnexpected).filter(
				(event) => event.type === "agent_switched",
			),
		).toEqual([]);

		// Browsers remain on their original agents and continue to receive only
		// their own agent's events.
		const alphaEvents = collectUntilDone(browserAlpha);
		const zetaSilence = collectFor(browserZeta, 200);
		browserAlpha.send(
			JSON.stringify({ type: "prompt", prompt: "hello from alpha browser" }),
		);
		expect(
			(await alphaEvents).find((event) => event.type === "text")?.text,
		).toBe("from alpha");
		// Zeta's browser stayed on zeta — alpha's prompt should not bleed over.
		expect(
			(await zetaSilence).find((event) => event.type === "text"),
		).toBeUndefined();

		browserAlpha.close();
		browserZeta.close();
		tui.close();
	});

	test("broadcasts sidebar invalidation events only to browser clients", async () => {
		let emitInvalidation:
			| ((event: {
					type: "browser_sidebar_invalidated";
					agentId?: string;
					sections: Array<"tree" | "cron" | "git" | "inbox">;
			  }) => void)
			| undefined;
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-alpha",
					name: "alpha",
					facade: new MockFacade(),
				}),
			],
			browserWatch: {
				agents: [
					{
						agentId: "agent-alpha",
						rootDir: "/workspace/agents/alpha",
					},
				],
				createWatcher: (options) => {
					emitInvalidation = options.onInvalidate;
					return {
						start() {},
						stop() {},
					};
				},
				gitRoot: "/workspace",
			},
		});
		cleanup = () => supervisor.stop();

		const browser = await connectBrowserWs(supervisor.port);
		await waitForEvent(browser, (event) => event.type === "runtime_status");
		const tui = await connectWs(supervisor.port);
		await waitForEvent(tui, (event) => event.type === "runtime_status");

		const browserEvent = waitForEvent(
			browser,
			(event) =>
				event.type === "browser_sidebar_invalidated" &&
				event.agentId === "agent-alpha",
		);
		const tuiEvents = collectFor(tui, 100);
		emitInvalidation?.({
			type: "browser_sidebar_invalidated",
			agentId: "agent-alpha",
			sections: ["tree", "cron"],
		});

		expect(await browserEvent).toEqual({
			type: "browser_sidebar_invalidated",
			agentId: "agent-alpha",
			sections: ["tree", "cron"],
		});
		expect(
			(await tuiEvents).filter(
				(event) => event.type === "browser_sidebar_invalidated",
			),
		).toEqual([]);

		browser.close();
		tui.close();
	});

	test("returns an agent menu for /agent", async () => {
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
				createAgentRuntime({
					agentId: "agent-mimi",
					name: "mimi",
					facade: new MockFacade(),
				}),
			],
		});
		cleanup = () => supervisor.stop();

		const ws = await connectWs(supervisor.port, "railly");
		await waitForEvent(ws, (event) => event.type === "runtime_status");

		ws.send(JSON.stringify({ type: "command", command: "/agent" }));
		expect(
			await waitForEvent(ws, (event) => event.type === "agent_menu"),
		).toEqual({
			type: "agent_menu",
			activeAgentId: "agent-railly",
			activeAgentName: "railly",
			agents: [
				{ agentId: "agent-mimi", name: "mimi" },
				{ agentId: "agent-railly", name: "railly" },
			],
		});

		ws.close();
	});

	test("uses the persisted tui agent id when no explicit agent is requested", async () => {
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
				createAgentRuntime({
					agentId: "agent-mimi",
					name: "mimi",
					facade: new MockFacade(),
				}),
			],
			getDefaultAgentId: () => "agent-mimi",
		});
		cleanup = () => supervisor.stop();

		const ws = await connectWs(supervisor.port);
		expect(
			await waitForEvent(ws, (event) => event.type === "agent_switched"),
		).toEqual({
			type: "agent_switched",
			agentId: "agent-mimi",
			name: "mimi",
		});

		ws.close();
	});

	test("browser clients fall back to the first agent in config order when no cookie or explicit agent is provided", async () => {
		// Browsers no longer share the TUI's global last-interactive-agent slot —
		// that would leak across surfaces in a multi-user setup. Without a cookie
		// mapping, fresh browsers land on the first agent in config order
		// (insertion order, not alphabetical), which lets `getDefaultAgentId` keep
		// working as a TUI-only hint without coupling the browser path.
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				// Insertion order: zeta first. Alphabetical order would put alpha
				// first; the test guards against that regression.
				createAgentRuntime({
					agentId: "agent-zeta",
					name: "zeta",
					facade: new MockFacade(),
				}),
				createAgentRuntime({
					agentId: "agent-alpha",
					name: "alpha",
					facade: new MockFacade(),
				}),
			],
			// Pinned to alpha for TUI; browser must still land on zeta (config first).
			getDefaultAgentId: () => "agent-alpha",
		});
		cleanup = () => supervisor.stop();

		const ws = await connectBrowserWs(supervisor.port);
		expect(
			await waitForEvent(ws, (event) => event.type === "agent_switched"),
		).toEqual({
			type: "agent_switched",
			agentId: "agent-zeta",
			name: "zeta",
		});

		ws.close();
	});

	test("browser clients with a cookie-bound agent re-bind to it on reconnect", async () => {
		// End-to-end cookie persistence: a browser that picked an agent via /agent
		// command must rebind to that agent on its next connection without
		// passing ?agent=, even when first-in-config differs.
		const cookieStore = new Map<string, string>();
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-alpha",
					name: "alpha",
					facade: new MockFacade(),
				}),
				createAgentRuntime({
					agentId: "agent-zeta",
					name: "zeta",
					facade: new MockFacade(),
				}),
			],
			getBrowserClientAgentId: (clientId) => cookieStore.get(clientId),
			rememberBrowserClientAgentId: (clientId, agentId) => {
				cookieStore.set(clientId, agentId);
			},
		});
		cleanup = () => supervisor.stop();

		// First connection: lands on alpha (config first), then switches to zeta.
		// The Set-Cookie header is observed via a one-shot HTTP probe to capture
		// the cookie value; subsequent ws connections re-send that cookie.
		const probeResponse = await fetch(`http://localhost:${supervisor.port}/`, {
			headers: { accept: "text/html" },
		});
		const setCookie = probeResponse.headers.get("set-cookie") ?? "";
		const cookieMatch = setCookie.match(/oc_client_id=([^;]+)/);
		expect(cookieMatch).not.toBeNull();
		const cookieValue = `oc_client_id=${cookieMatch?.[1]}`;
		await probeResponse.body?.cancel();

		const first = await connectBrowserWsWithCookie(
			supervisor.port,
			cookieValue,
		);
		expect(
			await waitForEvent(first, (event) => event.type === "agent_switched"),
		).toMatchObject({ name: "alpha" });
		first.send(JSON.stringify({ type: "command", command: "/agent zeta" }));
		await waitForEvent(
			first,
			(event) => event.type === "agent_switched" && event.name === "zeta",
		);
		first.close();

		// Reconnect with the same cookie → server reads the persisted mapping and
		// binds straight to zeta, no /agent command needed.
		const second = await connectBrowserWsWithCookie(
			supervisor.port,
			cookieValue,
		);
		expect(
			await waitForEvent(second, (event) => event.type === "agent_switched"),
		).toMatchObject({ name: "zeta" });
		second.close();
	});

	test("/api/agents reports the active agent for the requesting browser cookie", async () => {
		const root = mkdtempSync(join(tmpdir(), "outclaw-supervisor-api-"));
		const cookieStore = new Map<string, string>();
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-alpha",
					name: "alpha",
					facade: new MockFacade(),
				}),
				createAgentRuntime({
					agentId: "agent-zeta",
					name: "zeta",
					facade: new MockFacade(),
				}),
			],
			browserApi: createBrowserApi({
				agents: [
					{
						agentId: "agent-alpha",
						name: "alpha",
						homeDir: join(root, "agents", "alpha"),
						providerId: "mock",
						terminalRunCommand: "",
					},
					{
						agentId: "agent-zeta",
						name: "zeta",
						homeDir: join(root, "agents", "zeta"),
						providerId: "mock",
						terminalRunCommand: "",
					},
				],
				getBrowserClientAgentId: (clientId) => cookieStore.get(clientId),
				getRememberedAgentId: () => "agent-alpha",
				gitRoot: root,
				homeDir: root,
				storesByAgent: new Map(),
			}),
			getBrowserClientAgentId: (clientId) => cookieStore.get(clientId),
			rememberBrowserClientAgentId: (clientId, agentId) => {
				cookieStore.set(clientId, agentId);
			},
		});
		cleanup = async () => {
			await supervisor.stop();
			rmSync(root, { force: true, recursive: true });
		};

		const probeResponse = await fetch(`http://localhost:${supervisor.port}/`, {
			headers: { accept: "text/html" },
		});
		const setCookie = probeResponse.headers.get("set-cookie") ?? "";
		const cookieMatch = setCookie.match(/oc_client_id=([^;]+)/);
		expect(cookieMatch).not.toBeNull();
		const cookieValue = `oc_client_id=${cookieMatch?.[1]}`;
		await probeResponse.body?.cancel();

		const ws = await connectBrowserWsWithCookie(supervisor.port, cookieValue);
		await waitForEvent(ws, (event) => event.type === "agent_switched");
		ws.send(JSON.stringify({ type: "command", command: "/agent zeta" }));
		await waitForEvent(
			ws,
			(event) => event.type === "agent_switched" && event.name === "zeta",
		);

		const response = await fetch(
			`http://localhost:${supervisor.port}/api/agents`,
			{
				headers: { cookie: cookieValue },
			},
		);
		const body = (await response.json()) as { activeAgentId?: string };

		expect(body.activeAgentId).toBe("agent-zeta");
		ws.close();
	});

	test("binds telegram clients to their routed agent and only lists accessible agents", async () => {
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-kuro",
					name: "kuro",
					facade: new MockFacade(),
				}),
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
				createAgentRuntime({
					agentId: "agent-mimi",
					name: "mimi",
					facade: new MockFacade(),
				}),
			],
			telegramRouting: {
				getAgentId(botId, telegramUserId) {
					expect(botId).toBe("bot-a");
					expect(telegramUserId).toBe(101);
					return "agent-mimi";
				},
				listAgentIds(botId, telegramUserId) {
					expect(botId).toBe("bot-a");
					expect(telegramUserId).toBe(101);
					return ["agent-railly", "agent-mimi"];
				},
				rememberAgentId() {},
			},
		});
		cleanup = () => supervisor.stop();

		const ws = await connectTelegramWs(supervisor.port, {
			botId: "bot-a",
			telegramUserId: 101,
		});
		expect(
			await waitForEvent(ws, (event) => event.type === "agent_switched"),
		).toEqual({
			type: "agent_switched",
			agentId: "agent-mimi",
			name: "mimi",
		});
		await waitForEvent(ws, (event) => event.type === "runtime_status");

		ws.send(JSON.stringify({ type: "command", command: "/agent" }));
		expect(
			await waitForEvent(ws, (event) => event.type === "agent_menu"),
		).toEqual({
			type: "agent_menu",
			activeAgentId: "agent-mimi",
			activeAgentName: "mimi",
			agents: [
				{ agentId: "agent-mimi", name: "mimi" },
				{ agentId: "agent-railly", name: "railly" },
			],
		});

		ws.close();
	});

	test("switching a telegram client persists only allowed routes", async () => {
		const remembered: Array<{
			agentId: string;
			botId: string;
			telegramUserId: number;
		}> = [];
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
				createAgentRuntime({
					agentId: "agent-mimi",
					name: "mimi",
					facade: new MockFacade(),
				}),
			],
			telegramRouting: {
				getAgentId() {
					return "agent-railly";
				},
				listAgentIds() {
					return ["agent-railly"];
				},
				rememberAgentId(botId, telegramUserId, agentId) {
					remembered.push({ agentId, botId, telegramUserId });
				},
			},
		});
		cleanup = () => supervisor.stop();

		const ws = await connectTelegramWs(supervisor.port, {
			botId: "bot-a",
			telegramUserId: 101,
		});
		await waitForEvent(ws, (event) => event.type === "runtime_status");

		ws.send(JSON.stringify({ type: "command", command: "/agent mimi" }));
		expect(await waitForEvent(ws, (event) => event.type === "error")).toEqual({
			type: "error",
			message: "Unknown agent: mimi",
		});
		expect(remembered).toEqual([]);

		ws.close();
	});

	test("control clients receive ask responses without runtime status noise", async () => {
		const raillyFacade = new MockFacade();
		raillyFacade.textChunks = ["from railly"];
		const mimiFacade = new MockFacade();
		mimiFacade.textChunks = ["from mimi"];
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: raillyFacade,
				}),
				createAgentRuntime({
					agentId: "agent-mimi",
					name: "mimi",
					facade: mimiFacade,
				}),
			],
		});
		cleanup = () => supervisor.stop();
		const ws = await connectControlWs(supervisor.port);

		ws.send(
			JSON.stringify({
				type: "ask",
				fromAgentId: "agent-railly",
				to: "mimi",
				message: "hello",
			}),
		);

		expect(
			await waitForEvent(ws, (event) =>
				["ask_response", "runtime_status", "agent_switched"].includes(
					event.type,
				),
			),
		).toEqual({
			type: "ask_response",
			text: "from mimi",
		});
		expect(mimiFacade.callOrder).toEqual([
			['[sync ask from agent "railly"]', "hello"].join("\n"),
		]);
		ws.close();
	});

	test("control ask rejects cycles while a peer ask is pending", async () => {
		const raillyFacade = new MockFacade();
		raillyFacade.textChunks = ["from railly"];
		const mimiFacade = new BlockingFacade();
		mimiFacade.textChunks = ["from mimi"];
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: raillyFacade,
				}),
				createAgentRuntime({
					agentId: "agent-mimi",
					name: "mimi",
					facade: mimiFacade,
				}),
			],
		});
		cleanup = () => supervisor.stop();
		const raillyWs = await connectControlWs(supervisor.port);
		const mimiWs = await connectControlWs(supervisor.port);

		raillyWs.send(
			JSON.stringify({
				type: "ask",
				fromAgentId: "agent-railly",
				to: "mimi",
				message: "hello",
			}),
		);
		await mimiFacade.started;

		mimiWs.send(
			JSON.stringify({
				type: "ask",
				fromAgentId: "agent-mimi",
				to: "railly",
				message: "reply via ask",
			}),
		);

		expect(
			await waitForEvent(mimiWs, (event) => event.type === "ask_error"),
		).toEqual({
			type: "ask_error",
			message:
				"cannot ask railly because it would create a peer ask cycle (railly -> mimi -> railly); answer the peer request directly in your current response",
		});
		expect(raillyFacade.callOrder).toEqual([]);
		mimiFacade.release();
		expect(
			await waitForEvent(raillyWs, (event) => event.type === "ask_response"),
		).toEqual({
			type: "ask_response",
			text: "from mimi",
		});

		raillyWs.close();
		mimiWs.close();
	});

	test("control send accepts without waiting for the target agent result", async () => {
		const raillyFacade = new MockFacade();
		const mimiFacade = new BlockingFacade();
		mimiFacade.textChunks = ["from mimi"];
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: raillyFacade,
				}),
				createAgentRuntime({
					agentId: "agent-mimi",
					name: "mimi",
					facade: mimiFacade,
				}),
			],
		});
		cleanup = () => supervisor.stop();
		const ws = await connectControlWs(supervisor.port);

		ws.send(
			JSON.stringify({
				type: "send",
				fromAgentId: "agent-railly",
				to: "mimi",
				message: "please continue independently",
			}),
		);

		expect(
			await waitForEvent(ws, (event) => event.type === "send_response"),
		).toEqual({
			type: "send_response",
		});
		await mimiFacade.started;
		expect(mimiFacade.callOrder).toEqual([
			[
				'[async send from agent "railly"]',
				"please continue independently",
			].join("\n"),
		]);
		mimiFacade.release();
		ws.close();
	});

	test("control clients trigger cron jobs scoped by cwd agent id", async () => {
		const raillyHome = createCronAgentHome("agent-railly", "run railly cron");
		const mimiHome = createCronAgentHome("agent-mimi", "run mimi cron");
		const raillyFacade = new MockFacade();
		raillyFacade.textChunks = ["railly cron result"];
		const mimiFacade = new MockFacade();
		mimiFacade.textChunks = ["mimi cron result"];
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					cwd: raillyHome,
					cronDir: join(raillyHome, "cron"),
					promptHomeDir: raillyHome,
					facade: raillyFacade,
				}),
				createAgentRuntime({
					agentId: "agent-mimi",
					name: "mimi",
					cwd: mimiHome,
					cronDir: join(mimiHome, "cron"),
					promptHomeDir: mimiHome,
					facade: mimiFacade,
				}),
			],
		});
		cleanup = async () => {
			await supervisor.stop();
			rmSync(raillyHome, { recursive: true, force: true });
			rmSync(mimiHome, { recursive: true, force: true });
		};
		const ws = await connectControlWs(supervisor.port);

		ws.send(
			JSON.stringify({
				type: "cron_run",
				cwd: raillyHome,
				jobName: "daily",
			}),
		);

		expect(
			await waitForEvent(ws, (event) => event.type === "cron_run_response"),
		).toEqual({
			type: "cron_run_response",
			jobName: "daily",
		});
		await waitForCondition(() =>
			raillyFacade.callOrder.includes("run railly cron"),
		);
		expect(mimiFacade.callOrder).toEqual([]);

		ws.close();
	});

	test("control clients start code prompts without changing the active chat session", async () => {
		const dbDir = mkdtempSync(join(tmpdir(), "outclaw-supervisor-code-"));
		const dbPath = join(dbDir, "sessions.sqlite");
		const store = new SessionStore(dbPath, { agentId: "agent-railly" });
		const codingSharedStore = new SessionStore(dbPath, {
			agentId: CODING_STORAGE_OWNER_ID,
		});
		const codingSessions = new CodingSessionStore(dbPath);
		const chatCodingLinks = new ChatCodingLinkStore(dbPath);
		const codingRepositories = new CodingRepositoryStore(dbPath);
		const codingEvents = new CodingSessionEventHub();
		store.upsert({
			providerId: "mock",
			sdkSessionId: "chat-session-123",
			title: "Existing chat",
			model: "opus",
			tag: "chat",
		});
		store.setActiveSessionId("mock", "chat-session-123");
		const codeHome = createAgentHome("agent-railly");
		writeFileSync(join(codeHome, "AGENTS.md"), "chat runtime prompt");
		const facade = new SessionInitializingMockFacade();
		const codingFacade = new SessionInitializingMockFacade();
		const codingService = createCodingService({
			facade: codingFacade,
			repositories: codingRepositories,
			sessions: codingSessions,
			events: codingEvents,
			sharedSessionStore: codingSharedStore,
		});
		const browserApi = createBrowserApi({
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					homeDir: codeHome,
					providerId: "mock",
					terminalRunCommand: "",
				},
			],
			chatCodingLinks,
			codingSessions,
			getRememberedAgentId: () => "agent-railly",
			gitRoot: dbDir,
			homeDir: dbDir,
			storesByAgent: new Map([["agent-railly", store]]),
		});
		const supervisor = createSupervisor({
			port: 0,
			browserApi,
			codingEvents,
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					cwd: "/tmp/agent-home",
					facade,
					promptHomeDir: codeHome,
					store,
					coding: codingService.runtime,
				}),
			],
		});
		cleanup = async () => {
			await supervisor.stop();
			await codingService.stop();
			chatCodingLinks.close();
			codingEvents.close();
			codingRepositories.close();
			codingSessions.close();
			codingSharedStore.close();
			store.close();
			rmSync(dbDir, { recursive: true, force: true });
			rmSync(codeHome, { recursive: true, force: true });
		};
		const ws = await connectControlWs(supervisor.port);
		const browser = await connectBrowserRuntimeWs(supervisor.port, "railly");
		const codingEvent = waitForEvent(
			browser,
			(event) =>
				event.type === "coding_session_event" &&
				(event.event as { type?: string } | undefined)?.type === "user_prompt",
		);
		const linkEvent = waitForEvent(
			browser,
			(event) => event.type === "browser_chat_coding_links_changed",
		);

		ws.send(
			JSON.stringify({
				type: "code_prompt",
				cwd: codeHome,
				prompt: "implement the parser",
			}),
		);

		const response = await waitForEvent(
			ws,
			(event) => event.type === "code_prompt_response",
		);
		expect(response).toMatchObject({
			providerId: "mock",
			sdkSessionId: "mock-session-123",
		});
		await expect(codingEvent).resolves.toMatchObject({
			type: "coding_session_event",
			providerId: "mock",
			sdkSessionId: "mock-session-123",
			event: {
				type: "user_prompt",
				text: "implement the parser",
			},
		});
		await waitForCondition(
			() => codingSharedStore.get("mock", "mock-session-123") !== undefined,
		);

		expect(codingFacade.lastParams?.prompt).toBe("implement the parser");
		expect(codingFacade.lastParams?.cwd).toBe(codeHome);
		expect(codingFacade.lastParams?.instructionPolicy?.mode).toBe(
			"provider_default",
		);
		expect(
			codingFacade.lastParams?.instructionPolicy?.systemPrompt,
		).toBeUndefined();
		expect(facade.lastParams?.prompt).toBeUndefined();
		expect(store.getActiveSessionId("mock")).toBe("chat-session-123");
		expect(store.get("mock", "chat-session-123")?.tag).toBe("chat");
		expect(codingSharedStore.get("mock", "mock-session-123")).toMatchObject({
			source: "code",
			tag: "code",
			title: "implement the parser",
		});
		expect(codingSessions.get("mock", "mock-session-123")).toMatchObject({
			cwd: codeHome,
			linkedChatSessionId: "chat-session-123",
			lifecycleStatus: "open",
			runStatus: "idle",
		});
		await expect(linkEvent).resolves.toMatchObject({
			type: "browser_chat_coding_links_changed",
			chatAgentId: "agent-railly",
			chatProviderId: "mock",
			chatSdkSessionId: "chat-session-123",
			codingProviderId: "mock",
			codingSdkSessionId: "mock-session-123",
		});
		expect(
			chatCodingLinks
				.listForChat({
					chatAgentId: "agent-railly",
					chatProviderId: "mock",
					chatSdkSessionId: "chat-session-123",
				})
				.map((session) => session.sdkSessionId),
		).toEqual(["mock-session-123"]);

		ws.close();
	});

	test("control ask rejects unknown target and self-calls", async () => {
		const supervisor = createSupervisor({
			port: 0,
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
		});
		cleanup = () => supervisor.stop();
		const ws = await connectControlWs(supervisor.port);

		ws.send(
			JSON.stringify({
				type: "ask",
				fromAgentId: "agent-railly",
				to: "mimi",
				message: "hello",
			}),
		);
		expect(
			await waitForEvent(ws, (event) => event.type === "ask_error"),
		).toEqual({
			type: "ask_error",
			message: 'agent "mimi" not found',
		});

		ws.send(
			JSON.stringify({
				type: "ask",
				fromAgentId: "agent-railly",
				to: "railly",
				message: "hello",
			}),
		);
		expect(
			await waitForEvent(ws, (event) => event.type === "ask_error"),
		).toEqual({
			type: "ask_error",
			message: "cannot ask self",
		});

		ws.close();
	});
});
