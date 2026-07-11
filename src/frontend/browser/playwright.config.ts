import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.pw.ts",
	outputDir: "./playwright-artifacts/test-results",
	fullyParallel: false,
	use: {
		baseURL: "http://127.0.0.1:3000",
		trace: "retain-on-failure",
	},
	projects: [
		{ name: "desktop", use: { ...devices["Desktop Chrome"] } },
		{
			name: "mobile",
			use: {
				...devices["iPhone 13"],
				browserName: "chromium",
			},
		},
	],
	webServer: {
		command: "bun run preview --host 127.0.0.1 --port 3000",
		url: "http://127.0.0.1:3000",
		reuseExistingServer: false,
	},
});
