import { describe, expect, test } from "bun:test";
import type {
	Facade,
	RuntimeStatusEvent,
	ServerEvent,
} from "../../../src/common/protocol.ts";
import { RuntimeClientGateway } from "../../../src/runtime/application/runtime-client-gateway.ts";
import type { WsClient } from "../../../src/runtime/transport/client-hub.ts";

function createStatusEvent(): RuntimeStatusEvent {
	return {
		type: "runtime_status",
		model: "sonnet",
		effort: "high",
		running: false,
	};
}

function mockWs(): WsClient & { events: () => ServerEvent[] } {
	const sent: string[] = [];
	return {
		send(payload: string) {
			sent.push(payload);
		},
		events() {
			return sent.map((item) => JSON.parse(item) as ServerEvent);
		},
	} as WsClient & { events: () => ServerEvent[] };
}

function createFacade(overrides: Partial<Facade> = {}): Facade {
	return {
		providerId: "mock",
		async *run() {},
		...overrides,
	};
}

describe("RuntimeClientGateway", () => {
	test("requestSkills reports synchronous backend throws as error events", async () => {
		const gateway = new RuntimeClientGateway({
			cwd: "/tmp/outclaw",
			facade: createFacade({
				getSkills() {
					throw new Error("skills exploded");
				},
			}),
			getStatusEvent: createStatusEvent,
		});
		const ws = mockWs();

		gateway.requestSkills(ws);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(ws.events()).toContainEqual({
			type: "error",
			message: "skills exploded",
		});
	});

	test("handleOpen reports history replay failures to the client", async () => {
		const gateway = new RuntimeClientGateway({
			facade: createFacade({
				readHistory() {
					throw new Error("history exploded");
				},
			}),
			getStatusEvent: () => ({
				...createStatusEvent(),
				sessionId: "sdk-123",
			}),
		});
		const ws = mockWs();

		expect(() => gateway.handleOpen(ws)).not.toThrow();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(ws.events()).toEqual([
			{
				type: "runtime_status",
				model: "sonnet",
				effort: "high",
				running: false,
				sessionId: "sdk-123",
			},
			{
				type: "error",
				message: "Failed to replay history: history exploded",
			},
		]);
	});
});
