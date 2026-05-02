import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentCommand } from "../../../src/cli/commands/agent.ts";
import { captureExitOutput } from "../../helpers/capture-exit.ts";

const TEMPLATES_DIR = join(import.meta.dir, "../../../src/templates");

const tempHomes: string[] = [];

function createHomeDir() {
	const homeDir = mkdtempSync(join(tmpdir(), "outclaw-agent-command-"));
	tempHomes.push(homeDir);
	return homeDir;
}

async function captureOutput(fn: () => void | Promise<void>) {
	const logs: string[] = [];
	const errors: string[] = [];
	const originalLog = console.log;
	const originalError = console.error;
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	console.error = (...args: unknown[]) => errors.push(args.join(" "));
	try {
		await fn();
		return { errors, logs };
	} finally {
		console.log = originalLog;
		console.error = originalError;
	}
}

function createOptions(
	homeDir: string,
	argv: readonly string[],
	tui: (explicitAgentName?: string) => void = () => {},
) {
	return {
		argv: ["bun", "oc", ...argv],
		homeDir,
		templatesDir: TEMPLATES_DIR,
		tui,
	};
}

describe("agentCommand", () => {
	afterEach(() => {
		for (const homeDir of tempHomes.splice(0)) {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("prints command usage and exits for missing subcommands and help flags", async () => {
		const homeDir = createHomeDir();

		const missing = await captureExitOutput(() =>
			agentCommand(createOptions(homeDir, ["agent"])),
		);
		expect(missing.code).toBe(1);
		expect(missing.logs.join("\n")).toContain("Usage: oc agent <list|");

		for (const argv of [
			["agent", "--help"],
			["agent", "list", "--help"],
			["agent", "create", "--help"],
			["agent", "rename", "--help"],
			["agent", "remove", "--help"],
			["agent", "config", "--help"],
			["agent", "ask", "--help"],
		]) {
			const output = await captureExitOutput(() =>
				agentCommand(createOptions(homeDir, argv)),
			);
			expect(output.code).toBe(0);
			expect(output.logs.join("\n")).toContain("Usage:");
		}
	});

	test("exits with specific usage when required command arguments are missing", async () => {
		const homeDir = createHomeDir();

		for (const [argv, usage] of [
			[["agent", "create"], "Usage: oc agent create <name>"],
			[
				["agent", "rename", "old"],
				"Usage: oc agent rename <old-name> <new-name>",
			],
			[["agent", "remove"], "Usage: oc agent remove <name>"],
			[["agent", "config"], "Usage: oc agent config <name>"],
			[["agent", "ask", "--to", "mimi"], "Usage: oc agent ask --to <target>"],
		] as const) {
			const output = await captureExitOutput(() =>
				agentCommand(createOptions(homeDir, argv)),
			);
			expect(output.code).toBe(1);
			expect(output.errors.join("\n")).toContain(usage);
		}
	});

	test("validates agent create and config numeric flags before touching disk", async () => {
		const homeDir = createHomeDir();

		for (const [argv, error] of [
			[
				["agent", "create", "bad-users", "--users", "1,nope"],
				"Invalid users: 1,nope",
			],
			[
				["agent", "create", "bad-cron-user", "--default-cron-user", "0"],
				"Invalid default cron user: 0",
			],
			[
				["agent", "create", "bad-rollover", "--rollover-idle", "-1"],
				"Invalid rollover idle minutes: -1",
			],
			[
				["agent", "config", "railly", "--users", "1,nope"],
				"Invalid users: 1,nope",
			],
			[
				["agent", "config", "railly", "--default-cron-user", ""],
				"Invalid default cron user:",
			],
			[
				["agent", "config", "railly", "--rollover-idle", "NaN"],
				"Invalid rollover idle minutes: NaN",
			],
		] as const) {
			const output = await captureExitOutput(() =>
				agentCommand(createOptions(homeDir, argv)),
			);
			expect(output.code).toBe(1);
			expect(output.errors.join("\n")).toContain(error);
		}

		expect(existsSync(join(homeDir, "agents"))).toBe(false);
	});

	test("validates agent ask flags before resolving the sender workspace", async () => {
		const homeDir = createHomeDir();

		for (const [argv, error] of [
			[
				["agent", "ask", "--to", "mimi", "--timeout", "0", "hello"],
				"Invalid timeout: 0",
			],
			[
				["agent", "ask", "--timeout", "10", "hello"],
				"Usage: oc agent ask --to <target>",
			],
			[
				["agent", "ask", "--to", "mimi", "--unknown", "hello"],
				"Usage: oc agent ask --to <target>",
			],
		] as const) {
			const output = await captureExitOutput(() =>
				agentCommand(createOptions(homeDir, argv)),
			);
			expect(output.code).toBe(1);
			expect(output.errors.join("\n")).toContain(error);
		}
	});

	test("lists no agents without requiring a daemon", async () => {
		const homeDir = createHomeDir();

		const output = await captureOutput(() =>
			agentCommand(createOptions(homeDir, ["agent", "list"])),
		);

		expect(output.logs).toEqual(["No agents"]);
		expect(output.errors).toEqual([]);
	});

	test("creates, configures, renames, lists, and removes an agent on disk", async () => {
		const homeDir = createHomeDir();

		const created = await captureOutput(() =>
			agentCommand(
				createOptions(homeDir, [
					"agent",
					"create",
					"railly",
					"--bot-token",
					"token-a",
					"--users",
					"1,2",
					"--default-cron-user",
					"2",
					"--rollover-idle",
					"45",
				]),
			),
		);
		expect(created.logs[0]).toBe("Created agent railly");

		const raillyHome = join(homeDir, "agents", "railly");
		const agentId = readFileSync(join(raillyHome, ".agent-id"), "utf-8").trim();
		expect(existsSync(join(raillyHome, "AGENTS.md"))).toBe(true);
		expect(existsSync(join(raillyHome, "skills", "oc", "SKILL.md"))).toBe(true);

		const configured = await captureOutput(() =>
			agentCommand(
				createOptions(homeDir, [
					"agent",
					"config",
					"railly",
					"--bot-token",
					"token-b",
					"--rollover-idle",
					"90",
				]),
			),
		);
		expect(configured.logs).toEqual(["Configured agent railly"]);

		const config = JSON.parse(
			readFileSync(join(homeDir, "config.json"), "utf-8"),
		);
		expect(config.agents[agentId].telegram).toMatchObject({
			allowedUsers: [1, 2],
			botToken: "token-b",
			defaultCronUserId: 2,
		});
		expect(config.agents[agentId].rollover).toEqual({ idleMinutes: 90 });

		const listedBeforeRename = await captureOutput(() =>
			agentCommand(createOptions(homeDir, ["agent", "list"])),
		);
		expect(listedBeforeRename.logs).toEqual(["railly"]);

		const renamed = await captureOutput(() =>
			agentCommand(
				createOptions(homeDir, ["agent", "rename", "railly", "mimi"]),
			),
		);
		expect(renamed.logs).toEqual(["Renamed agent railly -> mimi"]);
		expect(existsSync(join(homeDir, "agents", "railly"))).toBe(false);
		expect(existsSync(join(homeDir, "agents", "mimi", ".agent-id"))).toBe(true);

		const removed = await captureOutput(() =>
			agentCommand(createOptions(homeDir, ["agent", "remove", "mimi"])),
		);
		expect(removed.logs).toEqual(["Removed agent mimi"]);
		expect(existsSync(join(homeDir, "agents", "mimi"))).toBe(false);
	});

	test("delegates unknown agent subcommands to the TUI selector path", async () => {
		const homeDir = createHomeDir();
		writeFileSync(join(homeDir, "config.json"), "{}\n");
		const tuiCalls: Array<string | undefined> = [];

		await agentCommand(
			createOptions(homeDir, ["agent", "railly"], (explicitAgentName) => {
				tuiCalls.push(explicitAgentName);
			}),
		);

		expect(tuiCalls).toEqual(["railly"]);
	});
});
