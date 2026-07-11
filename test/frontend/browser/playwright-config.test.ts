import { describe, expect, test } from "bun:test";
import playwrightConfig from "../../../src/frontend/browser/playwright.config.ts";

describe("browser Playwright config", () => {
	test("serves the production preview at the configured base URL", () => {
		expect(playwrightConfig.use?.baseURL).toBe("http://127.0.0.1:3000");
		expect(playwrightConfig.webServer).toMatchObject({
			command: "bun run preview --host 127.0.0.1 --port 3000",
			reuseExistingServer: false,
			url: "http://127.0.0.1:3000",
		});
	});
});
