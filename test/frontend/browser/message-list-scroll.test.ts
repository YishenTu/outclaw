import { describe, expect, test } from "bun:test";
import { createChatTranscriptItems } from "../../../src/frontend/browser/components/transcript/chat-transcript-items.ts";
import { displayMessageRenderKey } from "../../../src/frontend/browser/components/transcript/transcript-items.ts";
import {
	createTranscriptAutoScrollState,
	createTranscriptAutoScrollToken,
	isNearTranscriptBottom,
	resolveTranscriptAutoScrollState,
	shouldShowTranscriptScrollToBottomButton,
} from "../../../src/frontend/browser/components/transcript/transcript-scroll.ts";

describe("browser message list scroll", () => {
	test("auto-scroll token stays stable for identical transcript content", () => {
		const first = createTranscriptAutoScrollToken({
			sessionKey: "agent-a:claude:sdk-1",
			items: createChatTranscriptItems({
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
				queuedPrompts: [],
				streamingText: "",
				streamingThinking: "",
				isStreaming: false,
				isCompacting: false,
				thinkingStartedAt: null,
			}),
		});

		const second = createTranscriptAutoScrollToken({
			sessionKey: "agent-a:claude:sdk-1",
			items: createChatTranscriptItems({
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
				queuedPrompts: [],
				streamingText: "",
				streamingThinking: "",
				isStreaming: false,
				isCompacting: false,
				thinkingStartedAt: null,
			}),
		});

		expect(second).toBe(first);
	});

	test("auto-scroll token changes when the transcript content changes", () => {
		const before = createTranscriptAutoScrollToken({
			sessionKey: "agent-a:claude:sdk-1",
			items: createChatTranscriptItems({
				sessionKey: "agent-a:claude:sdk-1",
				messages: [
					{
						kind: "chat",
						role: "assistant",
						content: "alpha",
					},
				],
				queuedPrompts: [],
				streamingText: "",
				streamingThinking: "",
				isStreaming: false,
				isCompacting: false,
				thinkingStartedAt: null,
			}),
		});

		const after = createTranscriptAutoScrollToken({
			sessionKey: "agent-a:claude:sdk-1",
			items: createChatTranscriptItems({
				sessionKey: "agent-a:claude:sdk-1",
				messages: [
					{
						kind: "chat",
						role: "assistant",
						content: "alpha",
					},
				],
				queuedPrompts: [],
				streamingText: "beta",
				streamingThinking: "",
				isStreaming: true,
				isCompacting: false,
				thinkingStartedAt: null,
			}),
		});

		expect(after).not.toBe(before);
	});

	test("auto-scroll token changes when the active session changes", () => {
		const first = createTranscriptAutoScrollToken({
			sessionKey: "agent-a:claude:sdk-1",
			items: [],
		});

		const second = createTranscriptAutoScrollToken({
			sessionKey: "agent-a:claude:sdk-2",
			items: [],
		});

		expect(second).not.toBe(first);
	});

	test("render keys stay unique for duplicate messages in the same session", () => {
		const message = {
			kind: "system" as const,
			event: "heartbeat" as const,
			text: "Heartbeat",
		};

		expect(
			displayMessageRenderKey({
				message,
				index: 0,
				sessionKey: "agent-a:claude:sdk-1",
			}),
		).not.toBe(
			displayMessageRenderKey({
				message,
				index: 1,
				sessionKey: "agent-a:claude:sdk-1",
			}),
		);
	});

	test("render keys stay session-scoped across session switches", () => {
		const message = {
			kind: "chat" as const,
			role: "assistant" as const,
			content: "HEARTBEAT_OK",
		};

		expect(
			displayMessageRenderKey({
				message,
				index: 0,
				sessionKey: "agent-a:claude:sdk-1",
			}),
		).not.toBe(
			displayMessageRenderKey({
				message,
				index: 0,
				sessionKey: "agent-a:claude:sdk-2",
			}),
		);
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

	test("pauses auto-scroll immediately when users scroll upward near the bottom", () => {
		let state = createTranscriptAutoScrollState();

		state = resolveTranscriptAutoScrollState(state, {
			intent: "away-from-bottom",
			metrics: {
				scrollTop: 648,
				clientHeight: 300,
				scrollHeight: 980,
			},
		});

		expect(state.stickToBottom).toBe(false);

		state = resolveTranscriptAutoScrollState(state, {
			intent: "none",
			metrics: {
				scrollTop: 650,
				clientHeight: 300,
				scrollHeight: 982,
			},
		});

		expect(state.stickToBottom).toBe(false);

		state = resolveTranscriptAutoScrollState(state, {
			intent: "none",
			metrics: {
				scrollTop: 682,
				clientHeight: 300,
				scrollHeight: 982,
			},
		});

		expect(state.stickToBottom).toBe(false);

		state = resolveTranscriptAutoScrollState(state, {
			intent: "toward-bottom",
			metrics: {
				scrollTop: 682,
				clientHeight: 300,
				scrollHeight: 982,
			},
		});

		expect(state.stickToBottom).toBe(true);
	});

	test("shows scroll-to-bottom button only while auto-scroll is paused", () => {
		let state = createTranscriptAutoScrollState();

		expect(shouldShowTranscriptScrollToBottomButton(state)).toBe(false);

		state = resolveTranscriptAutoScrollState(state, {
			intent: "away-from-bottom",
			metrics: {
				scrollTop: 648,
				clientHeight: 300,
				scrollHeight: 980,
			},
		});

		expect(shouldShowTranscriptScrollToBottomButton(state)).toBe(true);

		state = resolveTranscriptAutoScrollState(state, {
			intent: "toward-bottom",
			metrics: {
				scrollTop: 682,
				clientHeight: 300,
				scrollHeight: 982,
			},
		});

		expect(shouldShowTranscriptScrollToBottomButton(state)).toBe(false);
	});
});
