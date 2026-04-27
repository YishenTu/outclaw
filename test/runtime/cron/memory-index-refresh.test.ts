import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshMemoryIndex } from "../../../src/runtime/cron/memory-index-refresh.ts";

const MEMORY_SKELETON = `# MEMORY.md

## Standing Notes

- keep terse responses

## Schema Router

- For the live schema buffer, read \`schemas/index.md\`.

## Flat Notes

- Browse \`notes/\` directly for flat references.
`;

function createHome(): string {
	const root = mkdtempSync(join(tmpdir(), "outclaw-index-"));
	writeFileSync(join(root, "MEMORY.md"), MEMORY_SKELETON);
	mkdirSync(join(root, "schemas"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	return root;
}

function schemaIndexPath(home: string): string {
	return join(home, "schemas", "index.md");
}

const SCHEMA_INDEX_TEMPLATE = `# Schema Index

_Start here when you need project-, person-, or topic-specific memory and do not yet know which schema to open._
_Use the tiers as a recency hint, not a priority rule: hot is recent, warm is less recent, cold is older background._

## Hot (<=14d)

These were active recently. Check here first.

<!-- hot-schemas:begin -->
<!-- hot-schemas:end -->

## Warm (15-30d)

These are less fresh, but still recent enough to matter.

<!-- warm-schemas:begin -->
<!-- warm-schemas:end -->

## Cold (>30d)

These are older background schemas. Open them when the topic reaches further back.

<!-- cold-schemas:begin -->
<!-- cold-schemas:end -->
`;

function writeSchema(
	home: string,
	name: string,
	frontmatter: Record<string, string>,
	what?: string,
): void {
	const fm = Object.entries(frontmatter)
		.map(([key, value]) => `${key}: ${value}`)
		.join("\n");
	const content = `---\n${fm}\n---\n\n# Model\n\n## What\n${what ?? ""}\n\n---\n\n# Observations\n`;
	writeFileSync(join(home, "schemas", name), content);
}

function writeSchemaFrontmatter(
	home: string,
	name: string,
	frontmatter: string,
): void {
	const content = `---\n${frontmatter}\n---\n\n# Model\n\n---\n\n# Observations\n`;
	writeFileSync(join(home, "schemas", name), content);
}

describe("refreshMemoryIndex", () => {
	let tempHome: string | undefined;

	afterEach(() => {
		if (tempHome && existsSync(tempHome)) {
			rmSync(tempHome, { force: true, recursive: true });
		}
		tempHome = undefined;
	});

	test("creates schemas/index.md with empty hot, warm, and cold tiers", () => {
		tempHome = createHome();
		const today = new Date(2026, 3, 20);

		refreshMemoryIndex({ memoryRoot: tempHome, now: today });

		const content = readFileSync(schemaIndexPath(tempHome), "utf-8");
		expect(content).toContain("# Schema Index");
		expect(content).toContain("## Hot (<=14d)");
		expect(content).toContain("## Warm (15-30d)");
		expect(content).toContain("## Cold (>30d)");
		expect(content).toContain("_None._");
	});

	test("preserves existing index template framing and only rewrites tier blocks", () => {
		tempHome = createHome();
		writeSchema(tempHome, "schema_hot.md", {
			name: "hot",
			kind: "topic",
			description: "hot schema",
			last_observation_at: "2026-04-10",
			last_synthesized: "2026-04-01",
		});
		writeFileSync(
			schemaIndexPath(tempHome),
			`# Custom Schema Index

Do not remove this intro.

## Hot (<=14d)

<!-- hot-schemas:begin -->
stale hot
<!-- hot-schemas:end -->

## Warm (15-30d)

<!-- warm-schemas:begin -->
stale warm
<!-- warm-schemas:end -->

## Cold (>30d)

<!-- cold-schemas:begin -->
stale cold
<!-- cold-schemas:end -->

Do not remove this outro.
`,
		);
		const today = new Date(2026, 3, 20);

		refreshMemoryIndex({ memoryRoot: tempHome, now: today });

		const content = readFileSync(schemaIndexPath(tempHome), "utf-8");
		expect(content).toContain("# Custom Schema Index");
		expect(content).toContain("Do not remove this intro.");
		expect(content).toContain("Do not remove this outro.");
		expect(content).toContain("- schema_hot.md — hot schema");
		expect(content).not.toContain("stale hot");
		expect(content).not.toContain("stale warm");
		expect(content).not.toContain("stale cold");
	});

	test("lists a recent schema under hot with frontmatter description", () => {
		tempHome = createHome();
		writeSchema(
			tempHome,
			"schema_project_outclaw.md",
			{
				name: "project_outclaw",
				kind: "project",
				description: "Mini OpenClaw — autonomous AI agent harness.",
				last_observation_at: "2026-04-20",
				last_synthesized: "2026-04-15",
			},
			"This body text should not be indexed.",
		);
		const today = new Date(2026, 3, 20);

		refreshMemoryIndex({ memoryRoot: tempHome, now: today });

		const content = readFileSync(schemaIndexPath(tempHome), "utf-8");
		expect(content).toContain(
			"<!-- hot-schemas:begin -->\n- schema_project_outclaw.md — Mini OpenClaw — autonomous AI agent harness.\n<!-- hot-schemas:end -->",
		);
		expect(content).not.toContain("This body text should not be indexed.");
	});

	test("accepts quoted dates and inline comments in schema frontmatter", () => {
		tempHome = createHome();
		writeSchemaFrontmatter(
			tempHome,
			"schema_yaml_dates.md",
			[
				"name: yaml_dates",
				"kind: topic",
				"description: YAML date syntax stays valid.",
				'last_observation_at: "2026-04-20"',
				"last_synthesized: 2026-04-15 # last weekly run",
			].join("\n"),
		);
		const today = new Date(2026, 3, 20);

		refreshMemoryIndex({ memoryRoot: tempHome, now: today });

		const content = readFileSync(schemaIndexPath(tempHome), "utf-8");
		expect(content).toContain(
			"- schema_yaml_dates.md — YAML date syntax stays valid.",
		);
	});

	test("ranks schemas by last_observation_at descending within a tier", () => {
		tempHome = createHome();
		writeSchema(tempHome, "schema_a.md", {
			name: "a",
			kind: "topic",
			description: "about A",
			last_observation_at: "2026-04-15",
			last_synthesized: "2026-04-01",
		});
		writeSchema(tempHome, "schema_b.md", {
			name: "b",
			kind: "topic",
			description: "about B",
			last_observation_at: "2026-04-20",
			last_synthesized: "2026-04-01",
		});
		const today = new Date(2026, 3, 20);

		refreshMemoryIndex({ memoryRoot: tempHome, now: today });

		const content = readFileSync(schemaIndexPath(tempHome), "utf-8");
		const bIndex = content.indexOf("schema_b.md");
		const aIndex = content.indexOf("schema_a.md");
		expect(bIndex).toBeGreaterThan(0);
		expect(aIndex).toBeGreaterThan(0);
		expect(bIndex).toBeLessThan(aIndex);
	});

	test("splits schemas into hot, warm, and cold tiers", () => {
		tempHome = createHome();
		writeSchema(tempHome, "schema_hot.md", {
			name: "hot",
			kind: "topic",
			description: "hot schema",
			last_observation_at: "2026-04-10",
			last_synthesized: "2026-04-01",
		});
		writeSchema(tempHome, "schema_warm.md", {
			name: "warm",
			kind: "topic",
			description: "warm schema",
			last_observation_at: "2026-03-25",
			last_synthesized: "2026-03-01",
		});
		writeSchema(tempHome, "schema_cold.md", {
			name: "cold",
			kind: "topic",
			description: "cold schema",
			last_observation_at: "2026-03-10",
			last_synthesized: "2026-03-01",
		});
		const today = new Date(2026, 3, 20);

		refreshMemoryIndex({ memoryRoot: tempHome, now: today });

		const content = readFileSync(schemaIndexPath(tempHome), "utf-8");
		expect(content).toContain(
			"<!-- hot-schemas:begin -->\n- schema_hot.md — hot schema\n<!-- hot-schemas:end -->",
		);
		expect(content).toContain(
			"<!-- warm-schemas:begin -->\n- schema_warm.md — warm schema\n<!-- warm-schemas:end -->",
		);
		expect(content).toContain(
			"<!-- cold-schemas:begin -->\n- schema_cold.md — cold schema\n<!-- cold-schemas:end -->",
		);
	});

	test("skips _template.md and schemas/index.md", () => {
		tempHome = createHome();
		writeSchema(tempHome, "_template.md", {
			name: "template",
			kind: "project",
			description: "template",
			last_observation_at: "2026-04-20",
			last_synthesized: "2026-04-20",
		});
		writeFileSync(schemaIndexPath(tempHome), SCHEMA_INDEX_TEMPLATE);
		const today = new Date(2026, 3, 20);

		refreshMemoryIndex({ memoryRoot: tempHome, now: today });

		const content = readFileSync(schemaIndexPath(tempHome), "utf-8");
		expect(content).not.toContain("_template.md");
	});

	test("creates schemas/index.md from the default template when missing", () => {
		tempHome = createHome();
		const today = new Date(2026, 3, 20);

		refreshMemoryIndex({ memoryRoot: tempHome, now: today });

		const content = readFileSync(schemaIndexPath(tempHome), "utf-8");
		expect(content).toBe(
			SCHEMA_INDEX_TEMPLATE.replaceAll(
				"<!-- hot-schemas:begin -->\n<!-- hot-schemas:end -->",
				"<!-- hot-schemas:begin -->\n_None._\n<!-- hot-schemas:end -->",
			)
				.replaceAll(
					"<!-- warm-schemas:begin -->\n<!-- warm-schemas:end -->",
					"<!-- warm-schemas:begin -->\n_None._\n<!-- warm-schemas:end -->",
				)
				.replaceAll(
					"<!-- cold-schemas:begin -->\n<!-- cold-schemas:end -->",
					"<!-- cold-schemas:begin -->\n_None._\n<!-- cold-schemas:end -->",
				),
		);
	});

	test("skips schemas with malformed frontmatter", () => {
		tempHome = createHome();
		writeFileSync(
			join(tempHome, "schemas", "schema_bad.md"),
			"---\nnot: valid: yaml\n---\n# Model\n",
		);
		writeSchema(tempHome, "schema_good.md", {
			name: "good",
			kind: "topic",
			description: "a good schema",
			last_observation_at: "2026-04-20",
			last_synthesized: "2026-04-01",
		});
		const today = new Date(2026, 3, 20);

		expect(() =>
			refreshMemoryIndex({ memoryRoot: tempHome as string, now: today }),
		).not.toThrow();

		const content = readFileSync(schemaIndexPath(tempHome), "utf-8");
		expect(content).toContain("schema_good.md");
		expect(content).not.toContain("schema_bad.md");
	});

	test("preserves MEMORY.md unchanged", () => {
		tempHome = createHome();
		writeSchema(tempHome, "schema_a.md", {
			name: "a",
			kind: "topic",
			description: "about A",
			last_observation_at: "2026-04-20",
			last_synthesized: "2026-04-01",
		});
		const before = readFileSync(join(tempHome, "MEMORY.md"), "utf-8");
		const today = new Date(2026, 3, 20);

		refreshMemoryIndex({ memoryRoot: tempHome, now: today });

		const after = readFileSync(join(tempHome, "MEMORY.md"), "utf-8");
		expect(after).toBe(before);
	});

	test("is idempotent on repeat refresh", () => {
		tempHome = createHome();
		writeSchema(tempHome, "schema_a.md", {
			name: "a",
			kind: "topic",
			description: "about A",
			last_observation_at: "2026-04-20",
			last_synthesized: "2026-04-01",
		});
		const today = new Date(2026, 3, 20);

		refreshMemoryIndex({ memoryRoot: tempHome, now: today });
		const first = readFileSync(schemaIndexPath(tempHome), "utf-8");
		refreshMemoryIndex({ memoryRoot: tempHome, now: today });
		const second = readFileSync(schemaIndexPath(tempHome), "utf-8");

		expect(second).toBe(first);
	});

	test("falls back to filename when schema description is missing", () => {
		tempHome = createHome();
		writeSchema(
			tempHome,
			"schema_project_outclaw.md",
			{
				name: "project_outclaw",
				kind: "project",
				last_observation_at: "2026-04-20",
				last_synthesized: "2026-04-15",
			},
			"This body text should not be indexed.",
		);
		const today = new Date(2026, 3, 20);

		refreshMemoryIndex({ memoryRoot: tempHome, now: today });

		const content = readFileSync(schemaIndexPath(tempHome), "utf-8");
		expect(content).toContain("- schema_project_outclaw.md — project_outclaw");
		expect(content).not.toContain("This body text should not be indexed.");
	});

	test("no-op when schemas/ is missing", () => {
		tempHome = mkdtempSync(join(tmpdir(), "outclaw-index-"));
		const today = new Date(2026, 3, 20);

		expect(() =>
			refreshMemoryIndex({ memoryRoot: tempHome as string, now: today }),
		).not.toThrow();
		expect(existsSync(schemaIndexPath(tempHome))).toBe(false);
	});
});
