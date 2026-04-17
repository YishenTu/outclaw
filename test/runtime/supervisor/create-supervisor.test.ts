import { afterEach, describe, expect, test } from "bun:test";
import { createAgentRuntime } from "../../../src/runtime/application/create-agent-runtime.ts";
import { createSupervisor } from "../../../src/runtime/supervisor/create-supervisor.ts";
import { MockFacade } from "../../helpers/mock-facade.ts";

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

	test("switching the active interactive agent also rebinds browser clients", async () => {
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
			getDefaultAgentId: () => "agent-alpha",
		});
		cleanup = () => supervisor.stop();

		const browser = await connectBrowserWs(supervisor.port);
		await waitForEvent(browser, (event) => event.type === "runtime_status");
		const tui = await connectWs(supervisor.port);
		await waitForEvent(tui, (event) => event.type === "runtime_status");

		const browserSwitched = waitForEvent(
			browser,
			(event) =>
				event.type === "agent_switched" &&
				event.agentId === "agent-zeta" &&
				event.name === "zeta",
		);
		tui.send(JSON.stringify({ type: "command", command: "/agent zeta" }));
		await browserSwitched;
		await waitForEvent(
			browser,
			(event) => event.type === "runtime_status" && event.agentName === "zeta",
		);

		const browserEvents = collectUntilDone(browser);
		const tuiEvents = collectUntilDone(tui);
		tui.send(JSON.stringify({ type: "prompt", prompt: "hello after switch" }));

		expect((await tuiEvents).find((event) => event.type === "text")?.text).toBe(
			"from zeta",
		);
		const mirrored = await browserEvents;
		expect(mirrored).toContainEqual({
			type: "user_prompt",
			prompt: "hello after switch",
			source: "tui",
		});
		expect(mirrored.find((event) => event.type === "text")?.text).toBe(
			"from zeta",
		);

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

	test("uses the persisted interactive agent id for browser clients when no explicit agent is requested", async () => {
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
			getDefaultAgentId: () => "agent-zeta",
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
