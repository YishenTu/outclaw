import { describe, expect, test } from "bun:test";
import {
	isOpenAiGptPiModel,
	PI_FAST_SERVICE_TIER,
	projectPiModels,
} from "../../../src/backend/adapters/pi/models.ts";

describe("Pi model projection", () => {
	test("advertises fast service tier for OpenAI GPT models", () => {
		expect(
			projectPiModels([
				{
					id: "openai-codex/gpt-5.5",
					model: "openai-codex/gpt-5.5",
				},
				{
					id: "openai/gpt-5.5",
					model: "openai/gpt-5.5",
				},
				{
					id: "anthropic/claude-sonnet-4-5",
					model: "anthropic/claude-sonnet-4-5",
				},
			]).map((model) => ({
				model: model.model,
				serviceTiers: model.serviceTiers,
			})),
		).toEqual([
			{
				model: "openai-codex/gpt-5.5",
				serviceTiers: [PI_FAST_SERVICE_TIER],
			},
			{
				model: "openai/gpt-5.5",
				serviceTiers: [PI_FAST_SERVICE_TIER],
			},
			{
				model: "anthropic/claude-sonnet-4-5",
				serviceTiers: [],
			},
		]);
	});

	test("preserves explicit service tier metadata from the driver", () => {
		const serviceTiers = [
			{
				id: "custom",
				name: "Custom",
				description: "Driver-provided tier",
			},
		];

		expect(
			projectPiModels([
				{
					id: "openai-codex/gpt-5.5",
					model: "openai-codex/gpt-5.5",
					serviceTiers,
				},
			])[0]?.serviceTiers,
		).toEqual(serviceTiers);
	});

	test("recognizes only provider-qualified OpenAI GPT model ids", () => {
		expect(isOpenAiGptPiModel("openai-codex/gpt-5.5")).toBe(true);
		expect(isOpenAiGptPiModel("openai/gpt-5.5")).toBe(true);
		expect(isOpenAiGptPiModel("gpt-5.5")).toBe(false);
		expect(isOpenAiGptPiModel("anthropic/gpt-5.5")).toBe(false);
		expect(isOpenAiGptPiModel("openai/o3")).toBe(false);
	});
});
