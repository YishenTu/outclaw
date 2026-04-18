import { describe, expect, test } from "bun:test";
import {
	createTranscriptAutoScrollToken,
	isNearTranscriptBottom,
} from "../../../src/frontend/browser/components/chat/message-list-scroll.ts";

describe("browser message list scroll", () => {
	test("auto-scroll token stays stable for identical transcript content", () => {
		const first = createTranscriptAutoScrollToken({
			sessionKey: "agent-a:claude:sdk-1",
			messages: [
				{
					kind: "chat",
					role: "user",
					content: "hello",
				},
				{
					kind: "chat",
					role: "assistant",
					content: "hi",
				},
			],
			streamingText: "",
			streamingThinking: "",
			isStreaming: false,
		});

		const second = createTranscriptAutoScrollToken({
			sessionKey: "agent-a:claude:sdk-1",
			messages: [
				{
					kind: "chat",
					role: "user",
					content: "hello",
				},
				{
					kind: "chat",
					role: "assistant",
					content: "hi",
				},
			],
			streamingText: "",
			streamingThinking: "",
			isStreaming: false,
		});

		expect(second).toBe(first);
	});

	test("auto-scroll token changes when the transcript content changes", () => {
		const before = createTranscriptAutoScrollToken({
			sessionKey: "agent-a:claude:sdk-1",
			messages: [
				{
					kind: "chat",
					role: "assistant",
					content: "alpha",
				},
			],
			streamingText: "",
			streamingThinking: "",
			isStreaming: false,
		});

		const after = createTranscriptAutoScrollToken({
			sessionKey: "agent-a:claude:sdk-1",
			messages: [
				{
					kind: "chat",
					role: "assistant",
					content: "alpha",
				},
			],
			streamingText: "beta",
			streamingThinking: "",
			isStreaming: true,
		});

		expect(after).not.toBe(before);
	});

	test("auto-scroll token changes when the active session changes", () => {
		const first = createTranscriptAutoScrollToken({
			sessionKey: "agent-a:claude:sdk-1",
			messages: [],
			streamingText: "",
			streamingThinking: "",
			isStreaming: false,
		});

		const second = createTranscriptAutoScrollToken({
			sessionKey: "agent-a:claude:sdk-2",
			messages: [],
			streamingText: "",
			streamingThinking: "",
			isStreaming: false,
		});

		expect(second).not.toBe(first);
	});

	test("treats users near the bottom as sticky", () => {
		expect(
			isNearTranscriptBottom({
				scrollTop: 660,
				clientHeight: 300,
				scrollHeight: 980,
			}),
		).toBe(true);
	});

	test("treats users away from the bottom as non-sticky", () => {
		expect(
			isNearTranscriptBottom({
				scrollTop: 500,
				clientHeight: 300,
				scrollHeight: 980,
			}),
		).toBe(false);
	});
});
