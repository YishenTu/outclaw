import { describe, expect, test } from "bun:test";
import type { ServerEvent } from "../../../src/common/protocol.ts";
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
			model: "opus",
			effort: "high",
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
});
