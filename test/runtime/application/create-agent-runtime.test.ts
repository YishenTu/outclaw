import { describe, expect, test } from "bun:test";
import type {
	Facade,
	FacadeEvent,
	RunParams,
	ServerEvent,
} from "../../../src/common/protocol.ts";
import { createAgentRuntime } from "../../../src/runtime/application/create-agent-runtime.ts";
import type { WsClient } from "../../../src/runtime/transport/client-hub.ts";
import { MockFacade } from "../../helpers/mock-facade.ts";

function mockWs(
	clientType: "telegram" | "tui" = "tui",
): WsClient & { events: () => ServerEvent[] } {
	const sent: string[] = [];
	const ws = {
		data: { clientType },
		send: (data: string) => {
			sent.push(data);
		},
		events: () => sent.map((item) => JSON.parse(item) as ServerEvent),
	};
	return ws as unknown as WsClient & { events: () => ServerEvent[] };
}

async function waitForDone(
	ws: WsClient & { events: () => ServerEvent[] },
): Promise<void> {
	return new Promise<void>((resolve) => {
		const check = setInterval(() => {
			if (ws.events().some((event) => event.type === "done")) {
				clearInterval(check);
				resolve();
			}
		}, 5);
	});
}

function createDeferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

class BlockingFacade implements Facade {
	providerId = "mock";
	started = createDeferred();
	release = createDeferred();

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		this.started.resolve();
		await this.release.promise;
		yield { type: "text", text: `echo: ${params.prompt}` };
		yield {
			type: "done",
			sessionId: `session-${params.prompt}`,
			durationMs: 1,
		};
	}
}

describe("createAgentRuntime", () => {
	test("emits runtime_status with the active agent name", async () => {
		const runtime = createAgentRuntime({
			agentId: "agent-railly",
			name: "railly",
			facade: new MockFacade(),
		});
		const ws = mockWs();

		runtime.handleOpen(ws);

		expect(
			ws.events().find((event) => event.type === "runtime_status"),
		).toEqual({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "high",
		});

		await runtime.stop();
	});

	test("includes a shared frontend notice in runtime_status when provided", async () => {
		const runtime = createAgentRuntime({
			agentId: "agent-railly",
			name: "railly",
			facade: new MockFacade(),
			getFrontendNotice: () => ({ kind: "restart_required" }),
		});
		const ws = mockWs();

		runtime.handleOpen(ws);

		expect(
			ws.events().find((event) => event.type === "runtime_status"),
		).toEqual({
			type: "runtime_status",
			agentName: "railly",
			providerId: "mock",
			model: "opus",
			effort: "high",
			notice: {
				kind: "restart_required",
			},
		});

		await runtime.stop();
	});

	test("creates independent runtimes without opening network ports", async () => {
		const raillyFacade = new MockFacade();
		const mimiFacade = new MockFacade();
		const raillyRuntime = createAgentRuntime({
			agentId: "agent-railly",
			name: "railly",
			facade: raillyFacade,
			cwd: "/tmp/railly",
		});
		const mimiRuntime = createAgentRuntime({
			agentId: "agent-mimi",
			name: "mimi",
			facade: mimiFacade,
			cwd: "/tmp/mimi",
		});

		const raillyWs = mockWs();
		raillyRuntime.handleOpen(raillyWs);
		raillyRuntime.handleMessage(
			raillyWs,
			JSON.stringify({ type: "prompt", prompt: "hello railly" }),
		);
		await waitForDone(raillyWs);

		const mimiWs = mockWs();
		mimiRuntime.handleOpen(mimiWs);
		mimiRuntime.handleMessage(
			mimiWs,
			JSON.stringify({ type: "prompt", prompt: "hello mimi" }),
		);
		await waitForDone(mimiWs);

		expect(raillyFacade.lastParams?.cwd).toBe("/tmp/railly");
		expect(mimiFacade.lastParams?.cwd).toBe("/tmp/mimi");

		await raillyRuntime.stop();
		await mimiRuntime.stop();
	});

	test("allows different agent runtimes to execute in parallel", async () => {
		const raillyFacade = new BlockingFacade();
		const mimiFacade = new BlockingFacade();
		const raillyRuntime = createAgentRuntime({
			agentId: "agent-railly",
			name: "railly",
			facade: raillyFacade,
		});
		const mimiRuntime = createAgentRuntime({
			agentId: "agent-mimi",
			name: "mimi",
			facade: mimiFacade,
		});

		const raillyWs = mockWs();
		const mimiWs = mockWs();
		raillyRuntime.handleOpen(raillyWs);
		mimiRuntime.handleOpen(mimiWs);

		raillyRuntime.handleMessage(
			raillyWs,
			JSON.stringify({ type: "prompt", prompt: "hello railly" }),
		);
		mimiRuntime.handleMessage(
			mimiWs,
			JSON.stringify({ type: "prompt", prompt: "hello mimi" }),
		);

		await Promise.all([
			raillyFacade.started.promise,
			mimiFacade.started.promise,
		]);

		raillyFacade.release.resolve();
		mimiFacade.release.resolve();

		await Promise.all([waitForDone(raillyWs), waitForDone(mimiWs)]);

		expect(
			raillyWs.events().find((event) => event.type === "done"),
		).toBeDefined();
		expect(
			mimiWs.events().find((event) => event.type === "done"),
		).toBeDefined();

		await raillyRuntime.stop();
		await mimiRuntime.stop();
	});
});
