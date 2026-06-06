import { describe, expect, test } from "bun:test";
import type {
	Facade,
	ProviderModelInfo,
	ServerEvent,
} from "../../../src/common/protocol.ts";
import { RuntimeClientGateway } from "../../../src/runtime/application/gateway/runtime-client-gateway.ts";
import { RuntimeControlPlane } from "../../../src/runtime/application/runtime-control-plane.ts";
import type { RuntimeExecutionCoordinator } from "../../../src/runtime/application/runtime-execution-coordinator.ts";
import { SessionService } from "../../../src/runtime/application/session-service.ts";
import { RuntimeState } from "../../../src/runtime/application/state/runtime-state.ts";
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

function model(id: string): ProviderModelInfo {
	return {
		id,
		model: id,
		displayName: id,
		description: "",
		isDefault: false,
		defaultReasoningEffort: "medium",
		supportedReasoningEfforts: ["medium"],
		serviceTiers: [],
	};
}

async function flushAsyncCommand() {
	for (let index = 0; index < 5; index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
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

	test("/new clears the active session without aborting active work", () => {
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

		expect(calls.abort).toBe(0);
		expect(ws.events()).toContainEqual({ type: "session_cleared" });
	});

	test("/session delete aborts active work before generic command handling", () => {
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

		controlPlane.handleCommand(ws, "/session delete sdk-123");

		expect(calls.abort).toBe(1);
	});

	test("model_select validates effort before changing blank-session provider/model", () => {
		const state = new RuntimeState("claude");
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

		controlPlane.handleModelSelect(ws, {
			type: "model_select",
			providerId: "codex",
			model: "gpt-5.5",
			effort: "turbo",
		});

		expect(state.providerId).toBe("claude");
		expect(state.resolvedModel).not.toBe("gpt-5.5");
		expect(ws.events()).toContainEqual({
			type: "error",
			message: "Invalid effort: turbo",
		});
	});

	test("bare model shortcuts can switch providers when no session is active", async () => {
		const state = new RuntimeState("claude");
		const clients = createGateway(state);
		const ws = mockWs();
		clients.handleOpen(ws);
		const { execution } = createExecution(false);
		const controlPlane = new RuntimeControlPlane({
			clients,
			createStatusEvent: () => state.createStatusEvent(),
			execution,
			modelProviderResolver: {
				async resolveProviderIdForModel(candidate) {
					return candidate === "gpt-5.5" ? "codex" : undefined;
				},
				async resolveModelSelection(candidate) {
					return candidate === "gpt-5.5"
						? { providerId: "codex", model: model("gpt-5.5") }
						: undefined;
				},
				async listModelSelections() {
					return [];
				},
			},
			sessions: new SessionService(state),
			state,
		});

		controlPlane.handleCommand(ws, "/gpt-5.5");
		await flushAsyncCommand();

		expect(state.providerId).toBe("codex");
		expect(state.model).toBe("gpt-5.5");
		expect(ws.events()).toContainEqual({
			type: "model_changed",
			model: "gpt-5.5",
			providerId: "codex",
		});
	});

	test("bare model shortcuts cannot cross providers while a session is active", async () => {
		const state = new RuntimeState("claude");
		state.completeRun({
			type: "done",
			sessionId: "sdk-1",
			durationMs: 1,
		});
		const clients = createGateway(state);
		const ws = mockWs();
		clients.handleOpen(ws);
		const { execution } = createExecution(false);
		const controlPlane = new RuntimeControlPlane({
			clients,
			createStatusEvent: () => state.createStatusEvent(),
			execution,
			modelProviderResolver: {
				async resolveProviderIdForModel(candidate) {
					return candidate === "gpt-5.5" ? "codex" : undefined;
				},
				async resolveModelSelection(candidate) {
					return candidate === "gpt-5.5"
						? { providerId: "codex", model: model("gpt-5.5") }
						: undefined;
				},
				async listModelSelections() {
					return [];
				},
			},
			sessions: new SessionService(state),
			state,
		});

		controlPlane.handleCommand(ws, "/gpt-5.5");
		await flushAsyncCommand();

		expect(state.providerId).toBe("claude");
		expect(state.model).not.toBe("gpt-5.5");
		expect(ws.events()).toContainEqual({
			type: "error",
			message:
				"Cannot switch to codex while a claude session is active; start a new session first.",
		});
	});

	test("model_select applies catalog context metadata to runtime usage", () => {
		const state = new RuntimeState("claude", undefined, {
			defaultModel: "opus",
		});
		state.completeRun({
			type: "done",
			sessionId: "sdk-1",
			durationMs: 1,
			usage: {
				inputTokens: 100_000,
				outputTokens: 5_000,
				cacheCreationTokens: 0,
				cacheReadTokens: 0,
				contextTokens: 100_000,
				contextWindow: 1_000_000,
				maxOutputTokens: 64_000,
				percentage: 10,
			},
		});
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

		controlPlane.handleModelSelect(ws, {
			type: "model_select",
			providerId: "claude",
			model: "sonnet",
			contextWindow: 200_000,
		});

		expect(state.usage).toMatchObject({
			contextTokens: 100_000,
			contextWindow: 200_000,
			percentage: 50,
		});
		expect(ws.events()).toContainEqual(
			expect.objectContaining({
				type: "runtime_status",
				model: "sonnet",
				usage: expect.objectContaining({
					contextWindow: 200_000,
					percentage: 50,
				}),
			}),
		);
	});

	test("model_select applies and clears provider service tier", () => {
		const state = new RuntimeState("codex");
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

		controlPlane.handleModelSelect(ws, {
			type: "model_select",
			providerId: "codex",
			model: "gpt-5.5",
			effort: "high",
			serviceTier: "priority",
		});

		expect(state.serviceTier).toBe("priority");
		expect(ws.events()).toContainEqual(
			expect.objectContaining({
				type: "runtime_status",
				model: "gpt-5.5",
				serviceTier: "priority",
			}),
		);

		controlPlane.handleModelSelect(ws, {
			type: "model_select",
			providerId: "codex",
			model: "gpt-5.5",
			effort: "high",
		});

		expect(state.serviceTier).toBeUndefined();
		const latestStatus = ws
			.events()
			.filter((event) => event.type === "runtime_status")
			.at(-1);
		expect(latestStatus).toEqual(
			expect.not.objectContaining({ serviceTier: expect.any(String) }),
		);
	});
});
