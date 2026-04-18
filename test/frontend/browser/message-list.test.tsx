import { describe, expect, test } from "bun:test";
import { CURRENT_HEARTBEAT_PROMPT } from "../../../src/common/heartbeat-prompt.ts";
import { MessageList } from "../../../src/frontend/browser/components/chat/message-list.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("browser message list", () => {
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
