import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEMPLATES_DIR = join(import.meta.dir, "../../src/templates");

function readTemplate(relativePath: string): string {
	return readFileSync(join(TEMPLATES_DIR, relativePath), "utf-8");
}

describe("memory template contract", () => {
	test("keeps MEMORY.md as a router instead of a generated schema catalog", () => {
		const memory = readTemplate("MEMORY.md");

		expect(memory).toContain("## Standing Notes");
		expect(memory).toContain("## Schema Router");
		expect(memory).toContain("## Flat Notes");
		expect(memory).toContain("schemas/index.md");
		expect(memory).not.toContain("<!-- hot-schemas:begin -->");
		expect(memory).not.toContain("last_observation_at:");
	});

	test("ships schema templates with runtime-consumed frontmatter and generated index markers", () => {
		const schemaTemplate = readTemplate("schemas/_template.md");
		const schemaIndex = readTemplate("schemas/index.md");

		for (const field of [
			"name:",
			"kind:",
			"description:",
			"last_observation_at:",
			"last_synthesized:",
		]) {
			expect(schemaTemplate).toContain(field);
		}
		expect(schemaTemplate).toContain("# Model");
		expect(schemaTemplate).toContain("# Observations");
		expect(schemaIndex).toContain("<!-- hot-schemas:begin -->");
		expect(schemaIndex).toContain("<!-- warm-schemas:begin -->");
		expect(schemaIndex).toContain("<!-- cold-schemas:begin -->");
	});

	test("memory cron templates preserve the router-first maintenance split", () => {
		const distill = readTemplate("cron/memory-distill.yaml");
		const route = readTemplate("cron/memory-route.yaml");
		const synthesize = readTemplate("cron/memory-synthesize.yaml");

		expect(distill).toContain(
			"Only modify `MEMORY.md`'s `## Standing Notes` section",
		);
		expect(distill).toContain(
			"Do NOT touch `## Schema Router` or `## Flat Notes`",
		);
		expect(route).toContain("Schema skeleton: `schemas/_template.md`");
		expect(route).toContain(
			"Append the observation to the target schema's `# Observations` section",
		);
		expect(synthesize).toContain(
			"List the schemas that need work with `outclaw_schema` mode `stale`",
		);
		expect(synthesize).toContain(
			"Observations are a short-term scratch buffer",
		);
	});

	test("pins memory cron templates to Pi model ids", () => {
		const template = readTemplate("cron/_template.yaml");
		const maintenanceTemplates = {
			"cron/memory-distill.yaml": "openai-codex/gpt-5.6-sol",
			"cron/memory-route.yaml": "openai-codex/gpt-5.6-terra",
			"cron/memory-synthesize.yaml": "openai-codex/gpt-5.6-sol",
			"cron/soul-evolve.yaml": "openai-codex/gpt-5.6-sol",
		};

		expect(template).toContain(
			"#   model     — provider-qualified model, e.g. openai-codex/gpt-5.5",
		);
		expect(template).toContain("model: openai-codex/gpt-5.6-sol");
		expect(template).not.toContain("opus | sonnet | haiku");

		for (const [templatePath, model] of Object.entries(maintenanceTemplates)) {
			const cronTemplate = readTemplate(templatePath);

			expect(cronTemplate).toContain(`model: ${model}`);
			expect(cronTemplate).not.toContain("model: opus");
			expect(cronTemplate).not.toContain("model: sonnet");
			expect(cronTemplate).not.toContain("model: haiku");
		}
	});
});
