import { describe, expect, test } from "bun:test";
import type { Facade, ServerEvent } from "../../../src/common/protocol.ts";
import { RuntimeClientGateway } from "../../../src/runtime/application/runtime-client-gateway.ts";
import { RuntimeControlPlane } from "../../../src/runtime/application/runtime-control-plane.ts";
import type { RuntimeExecutionCoordinator } from "../../../src/runtime/application/runtime-execution-coordinator.ts";
import { RuntimeState } from "../../../src/runtime/application/runtime-state.ts";
import { SessionService } from "../../../src/runtime/application/session-service.ts";
import type { WsClient } from "../../../src/runtime/transport/client-hub.ts";

function mockWs(): WsClient & { events: () => ServerEvent[] } {
	const sent: string[] = [];
	return {
		data: { clientType: "tui" },
		send(payload: string) {
			sent.push(payload);
		},
		events() {
			return sent.map((item) => JSON.parse(item) as ServerEvent);
		},
	} as WsClient & { events: () => ServerEvent[] };
}

function createGateway(state: RuntimeState) {
	return new RuntimeClientGateway({
		facade: {
			providerId: "mock",
			async *run() {},
		} as Facade,
		getStatusEvent: () => state.createStatusEvent(),
	});
}

function createExecution(abortResult: boolean) {
	const calls = {
		abort: 0,
	};
	return {
		calls,
		execution: {
			abortActiveRun() {
				calls.abort++;
				return abortResult;
			},
		} as unknown as RuntimeExecutionCoordinator,
	};
}

describe("RuntimeControlPlane", () => {
	test("/stop aborts the active visible run and reports the interruption", () => {
		const state = new RuntimeState("mock");
		const clients = createGateway(state);
		const ws = mockWs();
		clients.handleOpen(ws);
		const { calls, execution } = createExecution(true);
		const controlPlane = new RuntimeControlPlane({
			clients,
			createStatusEvent: () => state.createStatusEvent(),
			execution,
			sessions: new SessionService(state),
			state,
		});

		controlPlane.handleCommand(ws, "/stop");

		expect(calls.abort).toBe(1);
		expect(ws.events()).toContainEqual({
			type: "status",
			message: "Request interrupted by user",
			presentation: "inline",
		});
	});

	test("/stop reports when there is no active visible run", () => {
		const state = new RuntimeState("mock");
		const clients = createGateway(state);
		const ws = mockWs();
		clients.handleOpen(ws);
		const { execution } = createExecution(false);
		const controlPlane = new RuntimeControlPlane({
			clients,
			createStatusEvent: () => state.createStatusEvent(),
			execution,
			sessions: new SessionService(state),
			state,
		});

		controlPlane.handleCommand(ws, "/stop");

		expect(ws.events()).toContainEqual({
			type: "status",
			message: "Nothing to stop",
			presentation: "inline",
		});
	});

	test("/restart aborts active work, broadcasts status, and invokes the restart handler", () => {
		const state = new RuntimeState("mock");
		const clients = createGateway(state);
		const ws = mockWs();
		clients.handleOpen(ws);
		let restarted = false;
		const { calls, execution } = createExecution(true);
		const controlPlane = new RuntimeControlPlane({
			clients,
			createStatusEvent: () => state.createStatusEvent(),
			execution,
			restart: () => {
				restarted = true;
			},
			sessions: new SessionService(state),
			state,
		});

		controlPlane.handleCommand(ws, "/restart");

		expect(calls.abort).toBe(1);
		expect(restarted).toBe(true);
		expect(ws.events()).toContainEqual({
			type: "status",
			message: "Restarting daemon...",
		});
	});

	test("/new and /session delete abort active work before generic command handling", () => {
		const state = new RuntimeState("mock");
		const clients = createGateway(state);
		const ws = mockWs();
		clients.handleOpen(ws);
		const { calls, execution } = createExecution(true);
		const controlPlane = new RuntimeControlPlane({
			clients,
			createStatusEvent: () => state.createStatusEvent(),
			execution,
			sessions: new SessionService(state),
			state,
		});

		controlPlane.handleCommand(ws, "/new");
		controlPlane.handleCommand(ws, "/session delete sdk-123");

		expect(calls.abort).toBe(2);
		expect(ws.events()).toContainEqual({ type: "session_cleared" });
	});
});
