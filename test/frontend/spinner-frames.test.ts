import { describe, expect, test } from "bun:test";
import {
	SPINNER_FRAMES,
	SPINNER_INTERVAL_MS,
} from "../../src/frontend/spinner-frames.ts";

describe("spinner frames", () => {
	test("matches the shared TUI and browser spinner contract", () => {
		expect(SPINNER_FRAMES).toEqual([
			"⠋",
			"⠙",
			"⠹",
			"⠸",
			"⠼",
			"⠴",
			"⠦",
			"⠧",
			"⠇",
			"⠏",
		]);
		expect(SPINNER_INTERVAL_MS).toBe(80);
	});
});
