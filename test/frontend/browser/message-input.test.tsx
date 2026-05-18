import { describe, expect, test } from "bun:test";
import { MessageInput } from "../../../src/frontend/browser/components/chat/composer/message-input.tsx";
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

	test("can render a text-only composer for surfaces that cannot submit images", () => {
		const html = renderToStaticMarkup(
			<MessageInput
				onSend={() => false}
				model={null}
				effort={null}
				onModelChange={() => false}
				onEffortChange={() => false}
				attachmentsEnabled={false}
			/>,
		);

		expect(html).toContain('placeholder="Type a message..."');
		expect(html).not.toContain("paste/drop an image");
	});

	test("hides only the thinking label prefix in compact mode", () => {
		const desktopHtml = renderToStaticMarkup(
			<MessageInput
				onSend={() => false}
				model={null}
				effort={null}
				onModelChange={() => false}
				onEffortChange={() => false}
			/>,
		);
		const compactHtml = renderToStaticMarkup(
			<MessageInput
				onSend={() => false}
				model={null}
				effort={null}
				onModelChange={() => false}
				onEffortChange={() => false}
				compact
			/>,
		);

		expect(desktopHtml).toContain("Thinking: Medium");
		expect(compactHtml).not.toContain("Thinking: Medium");
		expect(compactHtml).toContain("<span>Medium</span>");
	});

	test("shows an enabled stop action while the current turn is interruptible", () => {
		const html = renderToStaticMarkup(
			<MessageInput
				onSend={() => false}
				model={null}
				effort={null}
				onModelChange={() => false}
				onEffortChange={() => false}
				interruptible
			/>,
		);

		const stopButton = html.match(
			/<button[^>]*aria-label="Stop response"[^>]*>/,
		)?.[0];
		expect(html).toContain('aria-label="Stop response"');
		expect(html).toContain("lucide-circle-stop");
		expect(html).not.toContain('aria-label="Send message"');
		expect(stopButton).toBeDefined();
		expect(stopButton).not.toContain(' disabled=""');
	});
});
