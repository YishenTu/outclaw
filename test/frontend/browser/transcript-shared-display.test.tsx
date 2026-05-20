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

	test("chat and code mode split provider thinking blocks the same way", () => {
		const chatItems = createChatTranscriptItems({
			sessionKey: "agent-a:codex:sdk-chat",
			messages: [],
			queuedPrompts: [],
			streamingThinking: "inspect filesrun tests",
			streamingThinkingBlocks: ["inspect files", "run tests"],
			streamingText: "",
			isStreaming: true,
			isCompacting: false,
			thinkingStartedAt: null,
		});
		const codingItems = createCodingTranscriptItems([
			streamItem(1, {
				type: "thinking",
				text: "inspect",
				blockId: "reasoning-1:summary:0",
			}),
			streamItem(2, {
				type: "thinking",
				text: " files",
				blockId: "reasoning-1:summary:0",
			}),
			streamItem(3, {
				type: "thinking",
				text: "run tests",
				blockId: "reasoning-1:summary:1",
			}),
		]);

		expect(chatItems.map((item) => item.kind)).toEqual([
			"thinking",
			"thinking",
			"activity",
		]);
		expect(codingItems.map((item) => item.kind)).toEqual([
			"thinking",
			"thinking",
		]);
	});

	test("chat mode preserves ordered streaming thinking and text segments", () => {
		const chatItems = createChatTranscriptItems({
			sessionKey: "agent-a:codex:sdk-chat",
			messages: [],
			queuedPrompts: [],
			streamingThinking: "inspect filesrun tests",
			streamingThinkingBlocks: ["inspect files", "run tests"],
			streamingText: "I found it.Done.",
			streamingSegments: [
				{
					type: "thinking",
					text: "inspect files",
					blockId: "reasoning-1:summary:0",
				},
				{ type: "text", text: "I found it." },
				{
					type: "thinking",
					text: "run tests",
					blockId: "reasoning-1:summary:1",
				},
				{ type: "text", text: "Done." },
			],
			isStreaming: true,
			isCompacting: false,
			thinkingStartedAt: null,
		});

		expect(
			chatItems
				.filter((item) => item.kind === "thinking" || item.kind === "message")
				.map((item) =>
					item.kind === "thinking"
						? item.content
						: item.message.kind === "chat"
							? item.message.content
							: "",
				),
		).toEqual(["inspect files", "I found it.", "run tests", "Done."]);
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

	test("uses the same vertical rhythm for split and adjacent thinking blocks", () => {
		const html = renderToStaticMarkup(
			<TranscriptItemList
				items={[
					{
						kind: "message",
						key: "assistant-segments",
						message: {
							kind: "chat",
							role: "assistant",
							content: "",
							segments: [
								{
									type: "thinking",
									text: "inspect files",
									blockId: "reasoning-1:summary:0",
								},
								{
									type: "thinking",
									text: "run tests",
									blockId: "reasoning-1:summary:1",
								},
							],
						},
					},
					{
						kind: "thinking",
						key: "split-thinking-1",
						content: "read hidden action result",
					},
					{
						kind: "thinking",
						key: "split-thinking-2",
						content: "continue planning",
					},
				]}
			/>,
		);

		const verticalRhythmContainers =
			html.match(/class="[^"]*flex[^"]*flex-col[^"]*gap-4[^"]*"/g) ?? [];
		expect(verticalRhythmContainers.length).toBeGreaterThanOrEqual(2);
		expect(html).not.toContain("mb-2");
		expect(html.match(/Thinking/g)).toHaveLength(4);
	});
});
