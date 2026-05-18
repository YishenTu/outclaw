import { describe, expect, test } from "bun:test";
import type { CodingSessionEvent } from "../../../src/common/protocol.ts";
import { createCodingTranscriptItems } from "../../../src/frontend/browser/coding/coding-event-renderer.tsx";
import { createChatTranscriptItems } from "../../../src/frontend/browser/components/transcript/chat-transcript-items.ts";
import { TranscriptItemList } from "../../../src/frontend/browser/components/transcript/transcript-item-list.tsx";
import type { CodingSessionEventStreamItem } from "../../../src/frontend/browser/lib/api.ts";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

function streamItem(
	sequence: number,
	event: unknown,
): CodingSessionEventStreamItem {
	return {
		providerId: "codex",
		sdkSessionId: "session-1",
		sequence,
		event: event as CodingSessionEvent,
		createdAt: sequence,
	};
}

describe("shared browser transcript display", () => {
	test("chat and code mode project normal conversation output into shared transcript items", () => {
		const chatItems = createChatTranscriptItems({
			sessionKey: "agent-a:claude:sdk-chat",
			messages: [
				{
					kind: "chat",
					role: "user",
					content: "hello",
				},
			],
			queuedPrompts: [],
			streamingThinking: "checking",
			streamingText: "hi",
			isStreaming: true,
			isCompacting: false,
			thinkingStartedAt: null,
		});
		const codingItems = createCodingTranscriptItems([
			streamItem(1, { type: "user_prompt", text: "hello" }),
			streamItem(2, { type: "thinking", text: "checking" }),
			streamItem(3, { type: "text", text: "hi" }),
		]);

		expect(chatItems.map((item) => item.kind)).toEqual([
			"message",
			"thinking",
			"message",
			"activity",
		]);
		expect(codingItems.map((item) => item.kind)).toEqual([
			"message",
			"thinking",
			"message",
		]);
	});

	test("only code mode emits tool transcript items", () => {
		const chatItems = createChatTranscriptItems({
			sessionKey: "agent-a:claude:sdk-chat",
			messages: [
				{
					kind: "chat",
					role: "assistant",
					content: "done",
				},
			],
			queuedPrompts: [],
			streamingThinking: "",
			streamingText: "",
			isStreaming: false,
			isCompacting: false,
			thinkingStartedAt: null,
		});
		const codingItems = createCodingTranscriptItems([
			streamItem(1, {
				type: "command_execution_started",
				callId: "call-1",
				command: "bun test",
				sessionId: "session-1",
			}),
		]);

		expect(chatItems.some((item) => item.kind === "tool")).toBe(false);
		expect(codingItems.some((item) => item.kind === "tool")).toBe(true);
	});

	test("the shared transcript renderer displays code-mode message and thinking items", () => {
		const html = renderToStaticMarkup(
			<TranscriptItemList
				items={createCodingTranscriptItems([
					streamItem(1, { type: "user_prompt", text: "fix the tests" }),
					streamItem(2, { type: "thinking", text: "checking failures" }),
					streamItem(3, { type: "text", text: "All set." }),
				])}
			/>,
		);

		expect(html).toContain("fix the tests");
		expect(html).toContain("Thinking");
		expect(html).toContain("checking failures");
		expect(html).toContain("All set.");
	});
});
