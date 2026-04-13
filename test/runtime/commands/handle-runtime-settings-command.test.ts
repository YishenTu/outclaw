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

		test("sends error for invalid effort values", () => {
			const { run, state, ws } = setup();
			const initialEffort = state.effort;
			expect(run("/thinking extreme")).toBe(true);

			expect(state.effort).toBe(initialEffort);
			expect(ws.events().find((event) => event.type === "error")).toEqual({
				type: "error",
				message: "Invalid effort: extreme. Valid: low, medium, high, max",
			});
		});
	});
});
