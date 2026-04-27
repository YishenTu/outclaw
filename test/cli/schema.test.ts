import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	formatSchemaStatusRows,
	loadSchemaStatuses,
	schemaCommand,
	selectSchemaStatuses,
} from "../../src/cli/schema.ts";
import { captureExitOutput } from "../helpers/capture-exit.ts";

function createMemoryRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "outclaw-schema-"));
	mkdirSync(join(root, "schemas"), { recursive: true });
	return root;
}

function createHomeDir(): string {
	return mkdtempSync(join(tmpdir(), "outclaw-schema-home-"));
}

function createAgentHome(
	homeDir: string,
	name: string,
	agentId: string,
): string {
	const agentHome = join(homeDir, "agents", name);
	mkdirSync(join(agentHome, "schemas"), { recursive: true });
	writeFileSync(join(agentHome, ".agent-id"), `${agentId}\n`);
	return agentHome;
}

function writeSchema(
	memoryRoot: string,
	filename: string,
	frontmatter: Record<string, string>,
): void {
	const body = Object.entries(frontmatter)
		.map(([key, value]) => `${key}: ${value}`)
		.join("\n");
	writeFileSync(
		join(memoryRoot, "schemas", filename),
		`---\n${body}\n---\n\n# Model\n\n---\n\n# Observations\n`,
	);
}

function writeSchemaFrontmatter(
	memoryRoot: string,
	filename: string,
	frontmatter: string,
): void {
	writeFileSync(
		join(memoryRoot, "schemas", filename),
		`---\n${frontmatter}\n---\n\n# Model\n\n---\n\n# Observations\n`,
	);
}

describe("schema status", () => {
	let tempRoot: string | undefined;
	let tempHome: string | undefined;
	const originalCwd = process.cwd();

	afterEach(() => {
		if (tempRoot && existsSync(tempRoot)) {
			rmSync(tempRoot, { force: true, recursive: true });
		}
		tempRoot = undefined;
		if (tempHome && existsSync(tempHome)) {
			rmSync(tempHome, { force: true, recursive: true });
		}
		tempHome = undefined;
		process.chdir(originalCwd);
	});

	test("loads schemas with freshness state and skips non-schema markdown files", () => {
		tempRoot = createMemoryRoot();
		writeSchema(tempRoot, "fresh-old.md", {
			name: "fresh-old",
			kind: "topic",
			last_observation_at: "2026-04-20",
			last_synthesized: "2026-04-21",
		});
		writeSchema(tempRoot, "fresh-equal.md", {
			name: "fresh-equal",
			kind: "topic",
			last_observation_at: "2026-04-21",
			last_synthesized: "2026-04-21",
		});
		writeSchema(tempRoot, "stale-newer.md", {
			name: "stale-newer",
			kind: "topic",
			last_observation_at: "2026-04-26",
			last_synthesized: "2026-04-20",
		});
		writeSchema(tempRoot, "stale-older.md", {
			name: "stale-older",
			kind: "topic",
			last_observation_at: "2026-04-26",
			last_synthesized: "2026-04-10",
		});
		writeSchema(tempRoot, "broken-missing.md", {
			name: "broken-missing",
			kind: "topic",
			last_synthesized: "2026-04-20",
		});
		writeSchema(tempRoot, "_template.md", {
			name: "template",
			kind: "topic",
			last_observation_at: "2026-04-26",
			last_synthesized: "2026-04-20",
		});
		writeSchema(tempRoot, "index.md", {
			name: "index",
			kind: "topic",
			last_observation_at: "2026-04-26",
			last_synthesized: "2026-04-20",
		});

		expect(loadSchemaStatuses(tempRoot)).toEqual([
			{
				name: "stale-older",
				last_observation_at: "2026-04-26",
				last_synthesized: "2026-04-10",
				state: "STALE",
			},
			{
				name: "stale-newer",
				last_observation_at: "2026-04-26",
				last_synthesized: "2026-04-20",
				state: "STALE",
			},
			{
				name: "broken-missing",
				last_observation_at: null,
				last_synthesized: "2026-04-20",
				state: "BROKEN",
				reason: "missing last_observation_at",
			},
			{
				name: "fresh-equal",
				last_observation_at: "2026-04-21",
				last_synthesized: "2026-04-21",
				state: "fresh",
			},
			{
				name: "fresh-old",
				last_observation_at: "2026-04-20",
				last_synthesized: "2026-04-21",
				state: "fresh",
			},
		]);
	});

	test("marks malformed frontmatter and malformed date fields as broken", () => {
		tempRoot = createMemoryRoot();
		writeFileSync(
			join(tempRoot, "schemas", "missing-frontmatter.md"),
			"# Model\n\n---\n\n# Observations\n",
		);
		writeFileSync(
			join(tempRoot, "schemas", "bad-frontmatter.md"),
			"---\nnot a key value line\n---\n# Model\n",
		);
		writeSchema(tempRoot, "bad-date.md", {
			name: "bad-date",
			kind: "topic",
			last_observation_at: "04-26-2026",
			last_synthesized: "2026-04-20",
		});

		expect(loadSchemaStatuses(tempRoot)).toEqual([
			{
				name: "bad-date",
				last_observation_at: null,
				last_synthesized: "2026-04-20",
				state: "BROKEN",
				reason: "malformed last_observation_at",
			},
			{
				name: "bad-frontmatter",
				last_observation_at: null,
				last_synthesized: null,
				state: "BROKEN",
				reason: "unparseable frontmatter",
			},
			{
				name: "missing-frontmatter",
				last_observation_at: null,
				last_synthesized: null,
				state: "BROKEN",
				reason: "missing frontmatter",
			},
		]);
	});

	test("accepts YAML date syntax that the schema index accepts", () => {
		tempRoot = createMemoryRoot();
		writeSchemaFrontmatter(
			tempRoot,
			"quoted-and-commented.md",
			[
				"name: quoted-and-commented",
				"kind: topic",
				'last_observation_at: "2026-04-26"',
				"last_synthesized: 2026-04-20 # last weekly run",
			].join("\n"),
		);

		expect(loadSchemaStatuses(tempRoot)).toEqual([
			{
				name: "quoted-and-commented",
				last_observation_at: "2026-04-26",
				last_synthesized: "2026-04-20",
				state: "STALE",
			},
		]);
	});

	test("formats aligned status rows and filters stale output", () => {
		tempRoot = createMemoryRoot();
		writeSchema(tempRoot, "food-and-drink.md", {
			name: "food-and-drink",
			kind: "topic",
			last_observation_at: "2026-04-26",
			last_synthesized: "2026-04-27",
		});
		writeSchema(tempRoot, "working-with-yishen.md", {
			name: "working-with-yishen",
			kind: "topic",
			last_observation_at: "2026-04-26",
			last_synthesized: "2026-04-20",
		});
		writeSchema(tempRoot, "broken-example.md", {
			name: "broken-example",
			kind: "topic",
			last_synthesized: "2026-04-20",
		});

		const statuses = loadSchemaStatuses(tempRoot);

		expect(formatSchemaStatusRows(statuses)).toBe(
			[
				"working-with-yishen  obs:2026-04-26  syn:2026-04-20  STALE",
				"broken-example       obs:?           syn:2026-04-20  BROKEN  (missing last_observation_at)",
				"food-and-drink       obs:2026-04-26  syn:2026-04-27  fresh",
			].join("\n"),
		);
		expect(
			formatSchemaStatusRows(selectSchemaStatuses(statuses, "stale")),
		).toBe(
			[
				"working-with-yishen  obs:2026-04-26  syn:2026-04-20  STALE",
				"broken-example       obs:?           syn:2026-04-20  BROKEN  (missing last_observation_at)",
			].join("\n"),
		);
	});

	test("schema command prints usage and validates arguments in-process", async () => {
		tempHome = createHomeDir();

		const missing = await captureExitOutput(() =>
			schemaCommand({ argv: ["bun", "oc", "schema"], homeDir: tempHome ?? "" }),
		);
		expect(missing.code).toBe(1);
		expect(missing.logs.join("\n")).toContain("Usage: oc schema");

		for (const argv of [
			["bun", "oc", "schema", "--help"],
			["bun", "oc", "schema", "status", "--help"],
			["bun", "oc", "schema", "stale", "--help"],
		]) {
			const output = await captureExitOutput(() =>
				schemaCommand({ argv, homeDir: tempHome ?? "" }),
			);
			expect(output.code).toBe(0);
			expect(output.logs.join("\n")).toContain("Usage:");
		}

		for (const [argv, error] of [
			[["bun", "oc", "schema", "unknown"], "Usage: oc schema"],
			[
				["bun", "oc", "schema", "status", "--agent"],
				"oc schema: --agent requires a value",
			],
			[
				["bun", "oc", "schema", "status", "--unknown"],
				'oc schema: unknown flag "--unknown"',
			],
			[
				["bun", "oc", "schema", "status", "extra"],
				'oc schema: unexpected argument "extra"',
			],
		] as const) {
			const output = await captureExitOutput(() =>
				schemaCommand({ argv: [...argv], homeDir: tempHome ?? "" }),
			);
			expect(output.code).toBe(1);
			expect([...output.errors, ...output.logs].join("\n")).toContain(error);
		}
	});

	test("schema command resolves agents by name or id and emits json", async () => {
		tempHome = createHomeDir();
		const agentHome = createAgentHome(tempHome, "railly", "agent-railly");
		writeSchema(agentHome, "fresh.md", {
			name: "fresh",
			kind: "topic",
			last_observation_at: "2026-04-20",
			last_synthesized: "2026-04-21",
		});
		writeSchema(agentHome, "stale.md", {
			name: "stale",
			kind: "topic",
			last_observation_at: "2026-04-26",
			last_synthesized: "2026-04-20",
		});

		const byName = await captureExitOutput(() =>
			schemaCommand({
				argv: ["bun", "oc", "schema", "stale", "--agent", "railly", "--json"],
				homeDir: tempHome ?? "",
			}),
		);
		const byId = await captureExitOutput(() =>
			schemaCommand({
				argv: ["bun", "oc", "schema", "status", "--agent", "agent-railly"],
				homeDir: tempHome ?? "",
			}),
		);

		expect(byName.code).toBeUndefined();
		expect(JSON.parse(byName.logs.join("\n"))).toEqual([
			{
				name: "stale",
				last_observation_at: "2026-04-26",
				last_synthesized: "2026-04-20",
				state: "STALE",
			},
		]);
		expect(byId.code).toBeUndefined();
		expect(byId.logs.join("\n")).toContain("fresh");
		expect(byId.logs.join("\n")).toContain("stale");
	});

	test("schema command reports unresolved cwd and agent selector errors", async () => {
		tempHome = createHomeDir();
		tempRoot = createMemoryRoot();
		process.chdir(tempRoot);

		const missingCwdAgent = await captureExitOutput(() =>
			schemaCommand({
				argv: ["bun", "oc", "schema", "status"],
				homeDir: tempHome ?? "",
			}),
		);
		expect(missingCwdAgent.code).toBe(1);
		expect(missingCwdAgent.errors.join("\n")).toContain(
			"cannot resolve current agent from cwd",
		);

		const missingSelector = await captureExitOutput(() =>
			schemaCommand({
				argv: ["bun", "oc", "schema", "status", "--agent", "missing"],
				homeDir: tempHome ?? "",
			}),
		);
		expect(missingSelector.code).toBe(1);
		expect(missingSelector.errors.join("\n")).toContain(
			"cannot read agents directory",
		);
	});
});
