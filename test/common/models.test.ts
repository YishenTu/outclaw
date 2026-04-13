import { describe, expect, test } from "bun:test";
import {
	contextWindowForAlias,
	contextWindowForResolvedModel,
	isModelAlias,
	MODEL_ALIAS_LIST,
	MODELS,
	resolveModelAlias,
} from "../../src/common/models.ts";

describe("isModelAlias", () => {
	test("returns true for each known alias", () => {
		for (const alias of MODEL_ALIAS_LIST) {
			expect(isModelAlias(alias)).toBe(true);
		}
	});

	test("returns false for unknown strings", () => {
		expect(isModelAlias("gpt-4")).toBe(false);
		expect(isModelAlias("")).toBe(false);
		expect(isModelAlias("OPUS")).toBe(false);
	});
});

describe("resolveModelAlias", () => {
	test("resolves known aliases to their SDK model ID", () => {
		for (const [alias, meta] of Object.entries(MODELS)) {
			expect(resolveModelAlias(alias)).toBe(meta.id);
		}
	});

	test("returns unknown strings as-is", () => {
		expect(resolveModelAlias("custom-model")).toBe("custom-model");
	});
});

describe("MODELS metadata", () => {
	test("opus has 1M context window", () => {
		expect(MODELS.opus.contextWindow).toBe(1_000_000);
	});

	test("sonnet has 200k context window", () => {
		expect(MODELS.sonnet.contextWindow).toBe(200_000);
	});

	test("haiku has 200k context window", () => {
		expect(MODELS.haiku.contextWindow).toBe(200_000);
	});
});

describe("contextWindowForAlias", () => {
	test("returns context window for known alias", () => {
		expect(contextWindowForAlias("opus")).toBe(1_000_000);
		expect(contextWindowForAlias("sonnet")).toBe(200_000);
	});

	test("returns undefined for unknown alias", () => {
		expect(contextWindowForAlias("gpt-4")).toBeUndefined();
	});
});

describe("contextWindowForResolvedModel", () => {
	test("returns context window for resolved model id", () => {
		expect(contextWindowForResolvedModel(MODELS.opus.id)).toBe(1_000_000);
		expect(contextWindowForResolvedModel(MODELS.sonnet.id)).toBe(200_000);
	});

	test("returns undefined for unknown model id", () => {
		expect(contextWindowForResolvedModel("unknown-model")).toBeUndefined();
	});
});
