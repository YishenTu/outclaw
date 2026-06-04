import { describe, expect, test } from "bun:test";
import type { EffortLevel } from "../../../src/common/commands.ts";
import type {
	ProviderModelInfo,
	ServerEvent,
} from "../../../src/common/protocol.ts";
import { RuntimeState } from "../../../src/runtime/application/state/runtime-state.ts";
import { handleRuntimeSettingsCommand } from "../../../src/runtime/commands/handle-runtime-settings-command.ts";
import {
	createModelProviderResolver,
	type ModelProviderResolver,
} from "../../../src/runtime/model-provider-resolver.ts";
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

function providerModel(
	model: string,
	overrides: Partial<ProviderModelInfo> = {},
): ProviderModelInfo {
	return {
		id: model,
		model,
		displayName: model,
		description: "",
		isDefault: false,
		defaultReasoningEffort: "medium",
		supportedReasoningEfforts: ["low", "medium", "high", "max"],
		serviceTiers: [],
		...overrides,
	};
}

function catalogResolver(): ModelProviderResolver {
	return createModelProviderResolver([
		{
			providerId: "claude",
			listModels: async () => [
				providerModel("opus", {
					id: "claude-opus-4-7[1m]",
					contextWindow: 1_000_000,
					supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
				}),
				providerModel("sonnet", { contextWindow: 200_000 }),
			],
		},
		{
			providerId: "codex",
			listModels: async () => [providerModel("gpt-5.5")],
		},
	]);
}

function setup(
	options: {
		defaultEffort?: EffortLevel;
		modelProviderResolver?: ModelProviderResolver;
		selectProviderModel?: (selection: {
			contextWindow?: number;
			effort?: EffortLevel;
			model: string;
			providerId: string;
		}) => void;
	} = {},
) {
	const hub = new ClientHub();
	const ws = mockWs();
	const observer = mockWs();
	const state = new RuntimeState(PROVIDER_ID, undefined, {
		defaultEffort: options.defaultEffort,
		defaultModel: "opus",
	});
	hub.add(ws);
	hub.add(observer);

	function run(command: string) {
		return handleRuntimeSettingsCommand({
			command,
			hub,
			modelProviderResolver: options.modelProviderResolver,
			selectProviderModel: options.selectProviderModel,
			state,
			ws,
		});
	}

	return { observer, run, state, ws };
}

describe("handleRuntimeSettingsCommand", () => {
	test("returns false for unrelated commands", async () => {
		const { run, ws } = setup();
		await expect(run("/status")).resolves.toBe(false);
		expect(ws.events()).toEqual([]);
	});

	describe("/model", () => {
		test("reports current model when no argument", async () => {
			const { run, state, ws } = setup();
			await expect(run("/model")).resolves.toBe(true);

			expect(
				ws.events().find((event) => event.type === "model_changed"),
			).toEqual({
				type: "model_changed",
				model: state.model,
				providerId: state.providerId,
			});
		});

		test("routes model choices through the provider catalog", async () => {
			let selection:
				| {
						contextWindow?: number;
						model: string;
						providerId: string;
				  }
				| undefined;
			const { run } = setup({
				modelProviderResolver: catalogResolver(),
				selectProviderModel: (nextSelection) => {
					selection = nextSelection;
				},
			});

			await expect(run("/model opus")).resolves.toBe(true);

			expect(selection).toEqual({
				providerId: "claude",
				model: "opus",
				contextWindow: 1_000_000,
			});
		});

		test("routes bare model shortcuts through the provider catalog", async () => {
			let selection:
				| {
						model: string;
						providerId: string;
				  }
				| undefined;
			const { run } = setup({
				modelProviderResolver: catalogResolver(),
				selectProviderModel: (nextSelection) => {
					selection = nextSelection;
				},
			});

			await expect(run("/gpt-5.5")).resolves.toBe(true);

			expect(selection).toEqual({
				providerId: "codex",
				model: "gpt-5.5",
			});
		});

		test("matches provider-qualified model ids through the catalog", async () => {
			let selection:
				| {
						model: string;
						providerId: string;
				  }
				| undefined;
			const { run } = setup({
				modelProviderResolver: catalogResolver(),
				selectProviderModel: (nextSelection) => {
					selection = nextSelection;
				},
			});

			await expect(run("/model codex/gpt-5.5")).resolves.toBe(true);

			expect(selection).toEqual({
				providerId: "codex",
				model: "gpt-5.5",
			});
		});

		test("accepts provider-local model ids that contain slashes", async () => {
			let selection:
				| {
						model: string;
						providerId: string;
				  }
				| undefined;
			const { run } = setup({
				modelProviderResolver: createModelProviderResolver([
					{
						providerId: "pi",
						listModels: async () => [
							providerModel("anthropic/claude-sonnet-4-5"),
						],
					},
				]),
				selectProviderModel: (nextSelection) => {
					selection = nextSelection;
				},
			});

			await expect(run("/model anthropic/claude-sonnet-4-5")).resolves.toBe(
				true,
			);

			expect(selection).toEqual({
				providerId: "pi",
				model: "anthropic/claude-sonnet-4-5",
			});
		});

		test("broadcasts refreshed runtime status with recalculated usage after a catalog model switch", async () => {
			const { observer, run, state } = setup({
				modelProviderResolver: catalogResolver(),
			});
			state.completeRun({
				type: "done",
				sessionId: "sdk-big",
				durationMs: 1,
				usage: {
					inputTokens: 100_000,
					outputTokens: 5_000,
					cacheCreationTokens: 0,
					cacheReadTokens: 0,
					contextWindow: 1_000_000,
					maxOutputTokens: 64_000,
					contextTokens: 100_000,
					percentage: 10,
				},
			});

			await expect(run("/model sonnet")).resolves.toBe(true);

			const observerStatus = observer
				.events()
				.find((event) => event.type === "runtime_status");
			expect(observerStatus).toMatchObject({
				type: "runtime_status",
				model: "sonnet",
				usage: {
					contextWindow: 200_000,
					contextTokens: 100_000,
					percentage: 50,
				},
			});
		});

		test("blocks model switch when context exceeds target catalog window", async () => {
			const { run, state, ws } = setup({
				modelProviderResolver: catalogResolver(),
			});
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

			await expect(run("/model sonnet")).resolves.toBe(true);
			expect(state.model).toBe("opus");
			expect(ws.events().find((event) => event.type === "error")).toEqual({
				type: "error",
				message:
					"context too large for sonnet (180000/160000) — run /compact first",
			});
		});

		test("sends error for unknown catalog models", async () => {
			const { run, state, ws } = setup({
				modelProviderResolver: catalogResolver(),
			});

			await expect(run("/model gpt-4")).resolves.toBe(true);

			expect(state.model).toBe("opus");
			expect(ws.events().find((event) => event.type === "error")).toEqual({
				type: "error",
				message: "Invalid model: gpt-4. Valid: opus, sonnet, gpt-5.5",
			});
		});
	});

	describe("/thinking", () => {
		test("reports current effort when no argument", async () => {
			const { run, state, ws } = setup();
			await expect(run("/thinking")).resolves.toBe(true);

			expect(
				ws.events().find((event) => event.type === "effort_changed"),
			).toEqual({
				type: "effort_changed",
				effort: state.effort,
				providerId: state.providerId,
			});
		});

		test("changes effort with a valid provider-neutral level", async () => {
			const { observer, run, state, ws } = setup();
			await expect(run("/thinking xhigh")).resolves.toBe(true);

			expect(state.effort).toBe("xhigh");
			expect(
				ws.events().find((event) => event.type === "effort_changed"),
			).toEqual({
				type: "effort_changed",
				effort: "xhigh",
				providerId: state.providerId,
			});
			expect(
				observer.events().find((event) => event.type === "effort_changed"),
			).toEqual({
				type: "effort_changed",
				effort: "xhigh",
				providerId: state.providerId,
			});
		});

		test("downgrades effort from catalog metadata when switching model", async () => {
			const { observer, run, state } = setup({
				defaultEffort: "low",
				modelProviderResolver: catalogResolver(),
			});
			await expect(run("/thinking xhigh")).resolves.toBe(true);
			expect(state.effort).toBe("xhigh");

			await expect(run("/model sonnet")).resolves.toBe(true);

			expect(state.model).toBe("sonnet");
			expect(state.effort).toBe("low");
			expect(observer.events().at(-2)).toEqual({
				type: "effort_changed",
				effort: "low",
				providerId: state.providerId,
			});
		});

		test("sends error for invalid effort values", async () => {
			const { run, state, ws } = setup();
			const initialEffort = state.effort;
			await expect(run("/thinking extreme")).resolves.toBe(true);

			expect(state.effort).toBe(initialEffort);
			expect(ws.events().find((event) => event.type === "error")).toEqual({
				type: "error",
				message:
					"Invalid effort: extreme. Valid: low, medium, high, xhigh, max",
			});
		});
	});
});
