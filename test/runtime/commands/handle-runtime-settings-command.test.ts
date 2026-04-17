import { describe, expect, test } from "bun:test";
import { MODEL_ALIAS_LIST } from "../../../src/common/models.ts";
import type { ServerEvent } from "../../../src/common/protocol.ts";
import { RuntimeState } from "../../../src/runtime/application/runtime-state.ts";
import { handleRuntimeSettingsCommand } from "../../../src/runtime/commands/handle-runtime-settings-command.ts";
import {
	ClientHub,
	type WsClient,
} from "../../../src/runtime/transport/client-hub.ts";

const PROVIDER_ID = "mock";

function mockWs(): WsClient & { events: () => ServerEvent[] } {
	const sent: string[] = [];
	const ws = {
		send: (data: string) => {
			sent.push(data);
		},
		events: () => sent.map((item) => JSON.parse(item) as ServerEvent),
	};
	return ws as unknown as WsClient & { events: () => ServerEvent[] };
}

function setup() {
	const hub = new ClientHub();
	const ws = mockWs();
	const observer = mockWs();
	const state = new RuntimeState(PROVIDER_ID);
	hub.add(ws);
	hub.add(observer);

	function run(command: string) {
		return handleRuntimeSettingsCommand({
			command,
			hub,
			state,
			ws,
		});
	}

	return { observer, run, state, ws };
}

describe("handleRuntimeSettingsCommand", () => {
	test("returns false for unrelated commands", () => {
		const { run, ws } = setup();
		expect(run("/status")).toBe(false);
		expect(ws.events()).toEqual([]);
	});

	describe("/model", () => {
		test("reports current model when no argument", () => {
			const { run, state, ws } = setup();
			expect(run("/model")).toBe(true);

			expect(
				ws.events().find((event) => event.type === "model_changed"),
			).toEqual({
				type: "model_changed",
				model: state.model,
			});
		});

		test("changes model with valid alias and broadcasts it", () => {
			const { observer, run, state, ws } = setup();
			expect(run("/model haiku")).toBe(true);

			expect(state.model).toBe("haiku");
			expect(
				ws.events().find((event) => event.type === "model_changed"),
			).toEqual({
				type: "model_changed",
				model: "haiku",
			});
			expect(
				observer.events().find((event) => event.type === "model_changed"),
			).toEqual({
				type: "model_changed",
				model: "haiku",
			});
		});

		test("accepts model alias shortcuts", () => {
			const { run, state } = setup();
			expect(run("/opus")).toBe(true);
			expect(state.model).toBe("opus");
		});

		test("blocks model switch when context exceeds target context window", () => {
			const { run, state, ws } = setup();
			// Simulate high context usage on opus (1M window)
			state.completeRun({
				type: "done",
				sessionId: "sdk-big",
				durationMs: 1,
				usage: {
					inputTokens: 180_000,
					outputTokens: 5_000,
					cacheCreationTokens: 0,
					cacheReadTokens: 0,
					contextWindow: 1_000_000,
					maxOutputTokens: 64_000,
					contextTokens: 180_000,
					percentage: 18,
				},
			});

			expect(run("/model sonnet")).toBe(true);
			expect(state.model).toBe("opus"); // unchanged
			expect(ws.events().find((e) => e.type === "error")).toBeDefined();
		});

		test("allows model switch when context fits target window", () => {
			const { run, state } = setup();
			state.completeRun({
				type: "done",
				sessionId: "sdk-small",
				durationMs: 1,
				usage: {
					inputTokens: 10_000,
					outputTokens: 1_000,
					cacheCreationTokens: 0,
					cacheReadTokens: 0,
					contextWindow: 1_000_000,
					maxOutputTokens: 64_000,
					contextTokens: 10_000,
					percentage: 1,
				},
			});

			expect(run("/model sonnet")).toBe(true);
			expect(state.model).toBe("sonnet");
		});

		test("allows model switch when no usage info available", () => {
			const { run, state } = setup();
			expect(run("/model sonnet")).toBe(true);
			expect(state.model).toBe("sonnet");
		});

		test("sends error for invalid model aliases", () => {
			const { run, state, ws } = setup();
			const initialModel = state.model;
			expect(run("/model gpt-4")).toBe(true);

			expect(state.model).toBe(initialModel);
			expect(ws.events().find((event) => event.type === "error")).toEqual({
				type: "error",
				message: `Invalid model: gpt-4. Valid: ${MODEL_ALIAS_LIST.join(", ")}`,
			});
		});
	});

	describe("/thinking", () => {
		test("reports current effort when no argument", () => {
			const { run, state, ws } = setup();
			expect(run("/thinking")).toBe(true);

			expect(
				ws.events().find((event) => event.type === "effort_changed"),
			).toEqual({
				type: "effort_changed",
				effort: state.effort,
			});
		});

		test("changes effort with a valid level and broadcasts it", () => {
			const { observer, run, state, ws } = setup();
			expect(run("/thinking max")).toBe(true);

			expect(state.effort).toBe("max");
			expect(
				ws.events().find((event) => event.type === "effort_changed"),
			).toEqual({
				type: "effort_changed",
				effort: "max",
			});
			expect(
				observer.events().find((event) => event.type === "effort_changed"),
			).toEqual({
				type: "effort_changed",
				effort: "max",
			});
		});

		test("accepts xhigh when current model is opus", () => {
			const { observer, run, state, ws } = setup();
			expect(state.model).toBe("opus");

			expect(run("/thinking xhigh")).toBe(true);
			expect(state.effort).toBe("xhigh");
			expect(
				ws.events().find((event) => event.type === "effort_changed"),
			).toEqual({ type: "effort_changed", effort: "xhigh" });
			expect(
				observer.events().find((event) => event.type === "effort_changed"),
			).toEqual({ type: "effort_changed", effort: "xhigh" });
		});

		test("rejects xhigh when current model is not opus", () => {
			const { run, state, ws } = setup();
			run("/model haiku");
			const before = state.effort;

			expect(run("/thinking xhigh")).toBe(true);
			expect(state.effort).toBe(before);
			expect(ws.events().find((event) => event.type === "error")).toEqual({
				type: "error",
				message: "Effort 'xhigh' requires the opus model (current: haiku)",
			});
		});

		test("downgrades xhigh to high when switching off opus", () => {
			const { observer, run, state } = setup();
			expect(run("/thinking xhigh")).toBe(true);
			expect(state.effort).toBe("xhigh");

			expect(run("/model haiku")).toBe(true);
			expect(state.model).toBe("haiku");
			expect(state.effort).toBe("high");

			const effortEvents = observer
				.events()
				.filter((event) => event.type === "effort_changed");
			expect(effortEvents.at(-1)).toEqual({
				type: "effort_changed",
				effort: "high",
			});
		});

		test("sends error for invalid effort values", () => {
			const { run, state, ws } = setup();
			const initialEffort = state.effort;
			expect(run("/thinking extreme")).toBe(true);

			expect(state.effort).toBe(initialEffort);
			expect(ws.events().find((event) => event.type === "error")).toEqual({
				type: "error",
				message:
					"Invalid effort: extreme. Valid: low, medium, high, xhigh, max",
			});
		});
	});
});
