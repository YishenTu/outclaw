import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	createOutclawLayout,
	outclawHomeDir,
} from "../../src/common/layout.ts";

describe("outclaw layout", () => {
	test("derives runtime, source, and agent paths from injected roots", () => {
		const layout = createOutclawLayout({
			homeDir: "/tmp/outclaw-home",
			srcRoot: "/repo/src",
		});

		expect(layout).toMatchObject({
			homeDir: "/tmp/outclaw-home",
			configPath: "/tmp/outclaw-home/config.json",
			envPath: "/tmp/outclaw-home/.env",
			pidPath: "/tmp/outclaw-home/daemon.pid",
			logPath: "/tmp/outclaw-home/daemon.log",
			readyPath: "/tmp/outclaw-home/daemon.ready",
			dbPath: "/tmp/outclaw-home/db.sqlite",
			filesRoot: "/tmp/outclaw-home/files",
			agentsDir: "/tmp/outclaw-home/agents",
			cliEntry: "/repo/src/cli.ts",
			daemonEntry: "/repo/src/index.ts",
			tuiEntry: "/repo/src/tui.ts",
			templatesDir: "/repo/src/templates",
			browserDir: "/repo/src/frontend/browser",
			browserDistDir: "/repo/src/frontend/browser/dist",
		});
		expect(layout.agent("railly")).toEqual({
			homeDir: "/tmp/outclaw-home/agents/railly",
			promptHomeDir: "/tmp/outclaw-home/agents/railly",
			cronDir: "/tmp/outclaw-home/agents/railly/cron",
		});
	});

	test("derives the default home directory from a user home", () => {
		expect(outclawHomeDir("/Users/example")).toBe(
			join("/Users/example", ".outclaw"),
		);
	});
});
