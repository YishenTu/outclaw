import { describe, expect, test } from "bun:test";
import type { ProviderModelInfo } from "../../src/common/protocol.ts";
import {
	createModelProviderResolver,
	staticModelProviderResolver,
} from "../../src/runtime/model-provider-resolver.ts";

function model(id: string, providerModel = id): ProviderModelInfo {
	return {
		id,
		model: providerModel,
		displayName: id,
		description: "",
		isDefault: false,
		defaultReasoningEffort: "medium",
		supportedReasoningEfforts: ["medium"],
		serviceTiers: [],
	};
}

describe("model provider resolver", () => {
	test("resolves provider ids from the configured provider catalogs", async () => {
		const resolver = createModelProviderResolver([
			{
				providerId: "claude",
				listModels: async () => [model("opus")],
			},
			{
				providerId: "codex",
				listModels: async () => [model("gpt-5.5")],
			},
		]);

		await expect(resolver.resolveProviderIdForModel("gpt-5.5")).resolves.toBe(
			"codex",
		);
		await expect(resolver.resolveProviderIdForModel("opus")).resolves.toBe(
			"claude",
		);
	});

	test("matches Claude resolved model ids against alias catalog rows", async () => {
		const resolver = createModelProviderResolver([
			{
				providerId: "claude",
				listModels: async () => [model("opus")],
			},
		]);

		await expect(
			resolver.resolveProviderIdForModel("claude-opus-4-7[1m]"),
		).resolves.toBe("claude");
	});

	test("does not infer providers from model name prefixes", async () => {
		const resolver = createModelProviderResolver([
			{
				providerId: "codex",
				listModels: async () => [model("gpt-5.5")],
			},
		]);

		await expect(
			resolver.resolveProviderIdForModel("gpt-unknown"),
		).resolves.toBeUndefined();
	});

	test("fails loudly when multiple providers expose the same model id", async () => {
		const resolver = createModelProviderResolver([
			{
				providerId: "provider-a",
				listModels: async () => [model("shared-model")],
			},
			{
				providerId: "provider-b",
				listModels: async () => [model("shared-model")],
			},
		]);

		await expect(
			resolver.resolveProviderIdForModel("shared-model"),
		).rejects.toThrow(
			"Model shared-model resolves to multiple providers: provider-a, provider-b",
		);
	});

	test("static resolver keeps single-provider runtimes provider-neutral", async () => {
		const resolver = staticModelProviderResolver("mock");

		await expect(resolver.resolveProviderIdForModel("anything")).resolves.toBe(
			"mock",
		);
		await expect(
			resolver.resolveProviderIdForModel("   "),
		).resolves.toBeUndefined();
	});
});
