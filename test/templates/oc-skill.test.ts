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
	formatAgentSendUsage,
	formatCodingMonitorUsage,
	formatCodingResumeUsage,
	formatCodingStartUsage,
	formatCodingStatusUsage,
	formatCodingUsage,
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
			"coding-sessions.md",
			"cron-jobs.md",
			"session-lookup.md",
			"memory-capture.md",
			"schema-memory.md",
		]) {
			expect(skill).toContain(`references/${reference}`);
		}
	});

	test("documents ask versus send peer communication guardrails", () => {
		const agentCom = readOcTemplate("references/agent-com.md");

		expectReferenceIncludesUsage(agentCom, formatAgentAskUsage());
		expectReferenceIncludesUsage(agentCom, formatAgentSendUsage());
		expect(agentCom).toContain(
			"Use `ask` only when you need the peer's answer to decide your next move.",
		);
		expect(agentCom).toContain(
			"Use `send` when you can continue without waiting for the peer's result.",
		);
		expect(agentCom).toContain('[sync ask from agent "<sender>"]');
		expect(agentCom).toContain('[async send from agent "<sender>"]');
		expect(agentCom).not.toContain("state that the sender");
		expect(agentCom).not.toContain("The sender is waiting");
		expect(agentCom).not.toContain("The sender is not waiting");
		expect(agentCom).toContain(
			"The daemon rejects calls that would form a peer-ask cycle",
		);
		expect(agentCom).not.toContain("async delegation");
		expect(agentCom).not.toContain("background execution");
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
		expect(agent).not.toContain("`oc agent ask");
		expect(agent).not.toContain("`oc agent send");
		expect(agent).toContain("`--rollover-idle`");
		expect(agent).toContain("`rollover.idleMinutes`");
		expectReferenceIncludesUsage(config, formatConfigRuntimeUsage());
		expectReferenceIncludesUsage(config, formatConfigSecureUsage());
	});

	test("coding, session, cron, note, and schema references match CLI usage syntax", () => {
		const coding = readOcTemplate("references/coding-sessions.md");
		const session = readOcTemplate("references/session-lookup.md");
		const cron = readOcTemplate("references/cron-jobs.md");
		const note = readOcTemplate("references/memory-capture.md");
		const schema = readOcTemplate("references/schema-memory.md");

		expectReferenceIncludesUsage(coding, formatCodingUsage());
		expectReferenceIncludesUsage(coding, formatCodingStartUsage());
		expectReferenceIncludesUsage(coding, formatCodingResumeUsage());
		expectReferenceIncludesUsage(coding, formatCodingMonitorUsage());
		expectReferenceIncludesUsage(coding, formatCodingStatusUsage());
		expect(coding).toContain("Archived sessions are restored");
		expectReferenceIncludesUsage(session, formatSessionListUsage());
		expectReferenceIncludesUsage(session, formatSessionSearchUsage());
		expectReferenceIncludesUsage(session, formatSessionTranscriptUsage());
		expectReferenceIncludesUsage(cron, formatCronRunUsage());
		expectReferenceIncludesUsage(cron, formatCronStatusUsage());
		expect(note).toContain(firstUsageSyntax(formatNoteUsage()));
		expectReferenceIncludesUsage(schema, formatSchemaStatusUsage());
	});
});
