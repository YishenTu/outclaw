import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatNoteUsage } from "../../src/cli/commands/note.ts";
import {
	formatAgentAskUsage,
	formatAgentConfigUsage,
	formatAgentCreateUsage,
	formatAgentListUsage,
	formatAgentRemoveUsage,
	formatAgentRenameUsage,
	formatConfigRuntimeUsage,
	formatConfigSecureUsage,
	formatCronRunUsage,
	formatCronStatusUsage,
	formatSchemaStatusUsage,
	formatSessionListUsage,
	formatSessionSearchUsage,
	formatSessionTranscriptUsage,
	formatStartUsage,
} from "../../src/cli/support/usage.ts";

const OC_SKILL_DIR = join(import.meta.dir, "../../src/templates/skills/oc");

function readOcTemplate(relativePath: string): string {
	return readFileSync(join(OC_SKILL_DIR, relativePath), "utf-8");
}

function usageSyntaxLines(usage: string): string[] {
	return usage
		.split("\n")
		.filter(
			(line) => line.startsWith("Usage: ") || line.startsWith("       oc "),
		)
		.map((line) => line.replace(/^Usage: /, "").trim());
}

function firstUsageSyntax(usage: string): string {
	const firstLine = usageSyntaxLines(usage)[0];
	if (!firstLine) {
		throw new Error("usage text did not include a syntax line");
	}
	return firstLine;
}

function expectReferenceIncludesUsage(reference: string, usage: string): void {
	const normalizedReference = reference.replaceAll("\\|", "|");
	for (const syntax of usageSyntaxLines(usage)) {
		expect(normalizedReference).toContain(`\`${syntax}\``);
	}
}

describe("oc skill template contract", () => {
	test("routes every agent-facing oc workflow to a reference file", () => {
		const skill = readOcTemplate("SKILL.md");

		for (const reference of [
			"daemon-operations.md",
			"agent-management.md",
			"config-management.md",
			"agent-com.md",
			"cron-jobs.md",
			"session-lookup.md",
			"memory-capture.md",
			"schema-memory.md",
		]) {
			expect(skill).toContain(`references/${reference}`);
		}
	});

	test("daemon, agent, and config references match CLI usage syntax", () => {
		const daemon = readOcTemplate("references/daemon-operations.md");
		const agent = readOcTemplate("references/agent-management.md");
		const config = readOcTemplate("references/config-management.md");

		expectReferenceIncludesUsage(daemon, formatStartUsage());
		expect(daemon).toContain("`oc browser`");
		expectReferenceIncludesUsage(agent, formatAgentListUsage());
		expectReferenceIncludesUsage(agent, formatAgentCreateUsage());
		expectReferenceIncludesUsage(agent, formatAgentConfigUsage());
		expectReferenceIncludesUsage(agent, formatAgentRenameUsage());
		expectReferenceIncludesUsage(agent, formatAgentRemoveUsage());
		expectReferenceIncludesUsage(agent, formatAgentAskUsage());
		expect(agent).toContain("`--rollover-idle`");
		expect(agent).toContain("`rollover.idleMinutes`");
		expectReferenceIncludesUsage(config, formatConfigRuntimeUsage());
		expectReferenceIncludesUsage(config, formatConfigSecureUsage());
	});

	test("session, cron, note, and schema references match CLI usage syntax", () => {
		const session = readOcTemplate("references/session-lookup.md");
		const cron = readOcTemplate("references/cron-jobs.md");
		const note = readOcTemplate("references/memory-capture.md");
		const schema = readOcTemplate("references/schema-memory.md");

		expectReferenceIncludesUsage(session, formatSessionListUsage());
		expectReferenceIncludesUsage(session, formatSessionSearchUsage());
		expectReferenceIncludesUsage(session, formatSessionTranscriptUsage());
		expectReferenceIncludesUsage(cron, formatCronRunUsage());
		expectReferenceIncludesUsage(cron, formatCronStatusUsage());
		expect(note).toContain(firstUsageSyntax(formatNoteUsage()));
		expectReferenceIncludesUsage(schema, formatSchemaStatusUsage());
	});
});
