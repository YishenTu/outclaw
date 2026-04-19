import { describe, expect, test } from "bun:test";
import { MessageInput } from "../../../src/frontend/browser/components/chat/message-input.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("browser message input", () => {
	test("uses the shared hidden-scrollbar styling on the composer textarea", () => {
		const html = renderToStaticMarkup(
			<MessageInput
				onSend={() => false}
				model={null}
				effort={null}
				onModelChange={() => false}
				onEffortChange={() => false}
			/>,
		);

		expect(html).toContain(
			"scrollbar-none h-full w-full resize-none bg-transparent px-2 pt-1 text-sm text-dark-100 placeholder:text-dark-500",
		);
	});
});
