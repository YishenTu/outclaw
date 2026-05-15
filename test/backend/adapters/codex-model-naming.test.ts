import { describe, expect, test } from "bun:test";
import { formatGptDisplayName } from "../../../src/backend/adapters/codex/model-naming.ts";

describe("formatGptDisplayName", () => {
	test("hyphenated mixed-case input normalizes to spaced title form", () => {
		expect(formatGptDisplayName("gpt-5.4-mini")).toBe("GPT 5.4 Mini");
		expect(formatGptDisplayName("GPT-5.4-Mini")).toBe("GPT 5.4 Mini");
		expect(formatGptDisplayName("GPT-5.5")).toBe("GPT 5.5");
		expect(formatGptDisplayName("gpt-5-codex")).toBe("GPT 5 Codex");
	});

	test("non-GPT names are returned unchanged", () => {
		expect(formatGptDisplayName("o3-mini")).toBe("o3-mini");
		expect(formatGptDisplayName("claude-3")).toBe("claude-3");
	});
});
