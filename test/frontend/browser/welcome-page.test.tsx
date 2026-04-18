import { describe, expect, test } from "bun:test";
import { WelcomePageView } from "../../../src/frontend/browser/components/welcome-page.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("WelcomePage", () => {
	test("renders the banner, tagline, and input slot", () => {
		const realRandom = Math.random;
		Math.random = () => 0;

		const html = renderToStaticMarkup(
			<WelcomePageView input={<section aria-label="Message input" />} />,
		);

		Math.random = realRandom;

		expect(html).toContain("██████╗");
		expect(html).toContain("~ WANTED: DEAD BUGS OR ALIVE FEATURES ~");
		expect(html).toContain('aria-label="Message input"');
	});

	test("renders the provided input slot content", () => {
		const html = renderToStaticMarkup(
			<WelcomePageView
				input={<section aria-label="Message input">composer</section>}
			/>,
		);

		expect(html).toContain(">composer<");
		expect(html).toContain('aria-label="Message input"');
	});
});
