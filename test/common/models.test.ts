import { describe, expect, test } from "bun:test";
import {
	isModelAlias,
	MODEL_ALIAS_LIST,
	MODEL_ALIASES,
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
		for (const [alias, id] of Object.entries(MODEL_ALIASES)) {
			expect(resolveModelAlias(alias)).toBe(id);
		}
	});

	test("returns unknown strings as-is", () => {
		expect(resolveModelAlias("custom-model")).toBe("custom-model");
	});
});
