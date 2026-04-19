import { describe, expect, test } from "bun:test";
import { Message } from "../../../src/frontend/browser/components/chat/message.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("browser chat message", () => {
	test("renders inline user images as data-url thumbnails", () => {
		const html = renderToStaticMarkup(
			<Message
				message={{
					kind: "chat",
					role: "user",
					content: "describe this",
					images: [
						{
							kind: "inline",
							mediaType: "image/png",
							base64: "abc123",
						},
					],
				}}
			/>,
		);

		expect(html).toContain('src="data:image/png;base64,abc123"');
		expect(html).toContain('alt="User upload 1"');
		expect(html).not.toContain("/tmp/");
	});

	test("does not expose managed image paths in the browser transcript", () => {
		const html = renderToStaticMarkup(
			<Message
				message={{
					kind: "chat",
					role: "user",
					content: "",
					images: [
						{
							kind: "managed",
							mediaType: "image/png",
							path: "/tmp/cat.png",
						},
					],
				}}
			/>,
		);

		expect(html).toContain("Image 1");
		expect(html).not.toContain("/tmp/cat.png");
	});
});
