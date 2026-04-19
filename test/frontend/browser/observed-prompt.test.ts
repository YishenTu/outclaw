import { describe, expect, test } from "bun:test";
import { toObservedDisplayMessage } from "../../../src/frontend/browser/observed-prompt.ts";

describe("toObservedDisplayMessage", () => {
	test("keeps tui prompts untagged in the browser", () => {
		expect(
			toObservedDisplayMessage({
				type: "user_prompt",
				prompt: "hello from tui",
				source: "tui",
			}),
		).toEqual({
			kind: "chat",
			role: "user",
			content: "hello from tui",
			images: undefined,
			replyContext: undefined,
		});
	});

	test("keeps image-only tui prompts untagged in the browser", () => {
		expect(
			toObservedDisplayMessage({
				type: "user_prompt",
				prompt: "",
				source: "tui",
			}),
		).toEqual({
			kind: "chat",
			role: "user",
			content: "",
			images: undefined,
			replyContext: undefined,
		});
	});

	test("keeps telegram prompts tagged", () => {
		expect(
			toObservedDisplayMessage({
				type: "user_prompt",
				prompt: "hello from telegram",
				source: "telegram",
			}),
		).toEqual({
			kind: "chat",
			role: "user",
			content: "[telegram]\nhello from telegram",
			images: undefined,
			replyContext: undefined,
		});
	});

	test("converts heartbeat prompts into a heartbeat system message", () => {
		expect(
			toObservedDisplayMessage({
				type: "user_prompt",
				prompt: "check heartbeat",
				source: "heartbeat",
			}),
		).toEqual({
			kind: "system",
			event: "heartbeat",
			text: "Heartbeat",
		});
	});

	test("converts rollover prompts into a rollover system message", () => {
		expect(
			toObservedDisplayMessage({
				type: "user_prompt",
				prompt: "finalize old session",
				source: "rollover",
			}),
		).toEqual({
			kind: "system",
			event: "rollover",
			text: "Rollover",
		});
	});
});
