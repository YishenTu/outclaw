import { describe, expect, test } from "bun:test";
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
});
