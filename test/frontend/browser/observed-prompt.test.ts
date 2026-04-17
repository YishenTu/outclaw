import { describe, expect, test } from "bun:test";
import { formatObservedPrompt } from "../../../src/frontend/browser/observed-prompt.ts";

describe("formatObservedPrompt", () => {
	test("keeps tui prompts untagged in the browser", () => {
		expect(
			formatObservedPrompt({
				type: "user_prompt",
				prompt: "hello from tui",
				source: "tui",
			}),
		).toBe("hello from tui");
	});

	test("keeps image-only tui prompts untagged in the browser", () => {
		expect(
			formatObservedPrompt({
				type: "user_prompt",
				prompt: "",
				source: "tui",
			}),
		).toBe("");
	});

	test("keeps telegram prompts tagged", () => {
		expect(
			formatObservedPrompt({
				type: "user_prompt",
				prompt: "hello from telegram",
				source: "telegram",
			}),
		).toBe("[telegram]\nhello from telegram");
	});

	test("keeps heartbeat prompts tagged", () => {
		expect(
			formatObservedPrompt({
				type: "user_prompt",
				prompt: "",
				source: "heartbeat",
			}),
		).toBe("[heartbeat]");
	});
});
