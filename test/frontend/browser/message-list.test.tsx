import { describe, expect, test } from "bun:test";
import { CURRENT_HEARTBEAT_PROMPT } from "../../../src/common/heartbeat-prompt.ts";
import { MessageList } from "../../../src/frontend/browser/components/chat/message-list.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("browser message list", () => {
	test("renders an assistant utility bar with locked duration and timestamp", () => {
		const userTimestamp = Date.parse("2025-01-15T14:30:00.000Z");
		const assistantTimestamp = Date.parse("2025-01-15T14:31:04.000Z");
		const html = renderToStaticMarkup(
			<MessageList
				messages={[
					{
						kind: "chat",
						role: "user",
						content: "hello",
						timestamp: userTimestamp,
					},
					{
						kind: "chat",
						role: "assistant",
						content: "world",
						timestamp: assistantTimestamp,
						assistantTurn: {
							source: "user",
							startedAt: userTimestamp,
							durationMs: assistantTimestamp - userTimestamp,
						},
					},
				]}
				streamingText=""
				streamingThinking=""
				isStreaming={false}
				isCompacting={false}
				thinkingStartedAt={null}
			/>,
		);

		const expectedTimestamp = new Intl.DateTimeFormat("en-US", {
			hour: "2-digit",
			hour12: false,
			minute: "2-digit",
		}).format(assistantTimestamp);

		expect(html).toContain("1m 04s");
		expect(html).toContain('aria-label="Copy final result"');
		expect(html).toContain(expectedTimestamp);
	});

	test("shows the copy action only on the final assistant message in a turn", () => {
		const userTimestamp = Date.parse("2025-01-15T14:30:00.000Z");
		const firstAssistantTimestamp = Date.parse("2025-01-15T14:30:30.000Z");
		const finalAssistantTimestamp = Date.parse("2025-01-15T14:31:04.000Z");
		const html = renderToStaticMarkup(
			<MessageList
				messages={[
					{
						kind: "chat",
						role: "user",
						content: "hello",
						timestamp: userTimestamp,
					},
					{
						kind: "chat",
						role: "assistant",
						content: "intermediate",
						timestamp: firstAssistantTimestamp,
					},
					{
						kind: "chat",
						role: "assistant",
						content: "final",
						timestamp: finalAssistantTimestamp,
						assistantTurn: {
							source: "user",
							startedAt: userTimestamp,
							durationMs: finalAssistantTimestamp - userTimestamp,
						},
					},
				]}
				streamingText=""
				streamingThinking=""
				isStreaming={false}
				isCompacting={false}
				thinkingStartedAt={null}
			/>,
		);

		const copyCount = (html.match(/aria-label="Copy final result"/g) ?? [])
			.length;
		const finalTimestamp = new Intl.DateTimeFormat("en-US", {
			hour: "2-digit",
			hour12: false,
			minute: "2-digit",
		}).format(finalAssistantTimestamp);
		const intermediateTimestamp = new Intl.DateTimeFormat("en-US", {
			hour: "2-digit",
			hour12: false,
			minute: "2-digit",
		}).format(firstAssistantTimestamp);

		expect(copyCount).toBe(1);
		expect(html).toContain(finalTimestamp);
		expect(html).not.toContain(intermediateTimestamp);
	});

	test("keeps a locked user turn duration when a later heartbeat result appears", () => {
		const userTimestamp = Date.parse("2025-01-15T14:30:00.000Z");
		const assistantTimestamp = Date.parse("2025-01-15T14:33:20.000Z");
		const heartbeatTimestamp = Date.parse("2025-01-15T14:40:30.000Z");
		const html = renderToStaticMarkup(
			<MessageList
				messages={[
					{
						kind: "chat",
						role: "user",
						content: "hello",
						timestamp: userTimestamp,
					},
					{
						kind: "chat",
						role: "assistant",
						content: "done",
						timestamp: assistantTimestamp,
						assistantTurn: {
							source: "user",
							startedAt: userTimestamp,
							durationMs: assistantTimestamp - userTimestamp,
						},
					},
					{
						kind: "system",
						event: "heartbeat",
						text: "Heartbeat",
					},
					{
						kind: "chat",
						role: "assistant",
						content: "Heartbeat result",
						timestamp: heartbeatTimestamp,
						assistantTurn: {
							source: "heartbeat",
						},
					},
				]}
				streamingText=""
				streamingThinking=""
				isStreaming={false}
				isCompacting={false}
				thinkingStartedAt={null}
			/>,
		);

		const copyCount = (html.match(/aria-label="Copy final result"/g) ?? [])
			.length;

		expect(copyCount).toBe(1);
		expect(html).toContain("3m 20s");
		expect(html).not.toContain("10m 30s");
	});

	test("renders streaming assistant text as markdown", () => {
		const html = renderToStaticMarkup(
			<MessageList
				messages={[]}
				streamingText={"**bold** and `code`"}
				streamingThinking=""
				isStreaming={true}
				isCompacting={false}
				thinkingStartedAt={null}
			/>,
		);

		expect(html).toContain("<strong>bold</strong>");
		expect(html).toContain("<code>code</code>");
		expect(html).not.toContain("**bold**");
		expect(html).not.toContain("`code`");
	});

	test("keeps the spinner visible as working once assistant output starts", () => {
		const html = renderToStaticMarkup(
			<MessageList
				messages={[]}
				streamingText="partial response"
				streamingThinking=""
				isStreaming={true}
				isCompacting={false}
				thinkingStartedAt={null}
			/>,
		);

		expect(html).toContain("Working...");
		expect(html).not.toContain("Thinking...");
	});

	test("shows thinking before the first assistant output arrives", () => {
		const html = renderToStaticMarkup(
			<MessageList
				messages={[]}
				streamingText=""
				streamingThinking=""
				isStreaming={true}
				isCompacting={false}
				thinkingStartedAt={null}
			/>,
		);

		expect(html).toContain("Thinking...");
		expect(html).not.toContain("Working...");
	});

	test("renders queued prompts with a pending indicator", () => {
		const html = renderToStaticMarkup(
			<MessageList
				messages={[]}
				queuedPrompts={[
					{
						kind: "chat",
						role: "user",
						content: "queued follow-up",
					},
				]}
				streamingText="current response"
				streamingThinking=""
				isStreaming={true}
				isCompacting={false}
				thinkingStartedAt={null}
			/>,
		);

		expect(html).toContain("current response");
		expect(html).toContain("queued follow-up");
		expect(html).toContain(
			"Queued - will be sent once the current turn completes.",
		);
	});

	test("renders heartbeat prompts as a compact indicator instead of the raw prompt", () => {
		const html = renderToStaticMarkup(
			<MessageList
				messages={[
					{
						kind: "system",
						event: "heartbeat",
						text: "Heartbeat",
					},
					{
						kind: "chat",
						role: "assistant",
						content: "HEARTBEAT_OK",
					},
				]}
				streamingText=""
				streamingThinking=""
				isStreaming={false}
				isCompacting={false}
				thinkingStartedAt={null}
			/>,
		);

		expect(html).toContain("Heartbeat");
		expect(html).toContain("HEARTBEAT_OK");
		expect(html).not.toContain(CURRENT_HEARTBEAT_PROMPT);
	});
});
