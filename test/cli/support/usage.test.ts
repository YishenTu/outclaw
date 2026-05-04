import { describe, expect, test } from "bun:test";
import {
	formatAgentAskUsage,
	formatAgentConfigUsage,
	formatAgentCreateUsage,
	formatAgentListUsage,
	formatAgentRemoveUsage,
	formatAgentRenameUsage,
	formatAgentUsage,
	formatConfigRuntimeUsage,
	formatConfigSecureUsage,
	formatConfigUsage,
	formatCronRunUsage,
	formatCronStatusUsage,
	formatCronUsage,
	formatOnboardUsage,
	formatSchemaStatusUsage,
	formatSchemaUsage,
	formatSessionListUsage,
	formatSessionSearchUsage,
	formatSessionTranscriptUsage,
	formatSessionUsage,
	formatStartUsage,
	formatUsage,
	hasHelpFlag,
	isHelpFlag,
	printAgentAskUsage,
	printAgentConfigUsage,
	printAgentCreateUsage,
	printAgentListUsage,
	printAgentRemoveUsage,
	printAgentRenameUsage,
	printAgentUsage,
	printConfigRuntimeUsage,
	printConfigSecureUsage,
	printConfigUsage,
	printCronRunUsage,
	printCronStatusUsage,
	printCronUsage,
	printOnboardUsage,
	printSchemaStatusUsage,
	printSchemaUsage,
	printSessionListUsage,
	printSessionSearchUsage,
	printSessionTranscriptUsage,
	printSessionUsage,
	printStartUsage,
	printUsage,
} from "../../../src/cli/support/usage.ts";

function capturePrint(fn: () => void) {
	const logs: string[] = [];
	const originalLog = console.log;
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	try {
		fn();
		return logs.join("\n");
	} finally {
		console.log = originalLog;
	}
}

describe("CLI usage text", () => {
	test("detects supported help flags", () => {
		expect(isHelpFlag("-h")).toBe(true);
		expect(isHelpFlag("--help")).toBe(true);
		expect(isHelpFlag("help")).toBe(false);
		expect(isHelpFlag(undefined)).toBe(false);
		expect(hasHelpFlag(["agent", "--help"])).toBe(true);
		expect(hasHelpFlag(["agent", "list"])).toBe(false);
	});

	test("formats every command usage with its command contract", () => {
		const cases: Array<[string, string[]]> = [
			[
				formatUsage(),
				[
					"Usage: oc <start|stop|restart|status|tui|browser|onboard|dev|build|agent|config|session|cron|note|schema>",
					"oc build && oc start",
				],
			],
			[
				formatStartUsage(),
				["Usage: oc start [--lan] [--host HOST]", "oc restart --host"],
			],
			[
				formatOnboardUsage(),
				["Usage: oc onboard", "interactive agent onboarding TUI"],
			],
			[
				formatAgentUsage(),
				[
					"Usage: oc agent <list|create|config|rename|remove|ask|name>",
					"<name>",
				],
			],
			[formatAgentListUsage(), ["Usage: oc agent list", "Lists configured"]],
			[
				formatAgentCreateUsage(),
				["Usage: oc agent create <name>", "~/.outclaw/agents/<name>"],
			],
			[
				formatAgentConfigUsage(),
				["Usage: oc agent config <name>", "Omitted flags are preserved"],
			],
			[
				formatAgentRenameUsage(),
				["Usage: oc agent rename <old-name> <new-name>", "keeps its agent id"],
			],
			[
				formatAgentRemoveUsage(),
				["Usage: oc agent remove <name>", "Removes an agent workspace"],
			],
			[
				formatAgentAskUsage(),
				["Usage: oc agent ask --to <target>", "current agent workspace"],
			],
			[
				formatConfigUsage(),
				["Usage: oc config <runtime|secure>", "move hardcoded telegram config"],
			],
			[
				formatConfigRuntimeUsage(),
				["Usage: oc config runtime", "Use --host 0.0.0.0"],
			],
			[
				formatConfigSecureUsage(),
				["Usage: oc config secure", "telegram secrets"],
			],
			[formatCronUsage(), ["Usage: oc cron <run|status>", "failed cron runs"]],
			[
				formatCronRunUsage(),
				["Usage: oc cron run <cron-name>", "prints nothing"],
			],
			[
				formatCronStatusUsage(),
				["Usage: oc cron status --failed", "Default since: 7d"],
			],
			[
				formatSchemaUsage(),
				["Usage: oc schema <status|stale>", "list stale and broken schemas"],
			],
			[
				formatSchemaStatusUsage(),
				["Usage: oc schema status", "compares last_observation_at"],
			],
			[
				formatSessionUsage(),
				["Usage: oc session <list|search|transcript>", "scope results"],
			],
			[
				formatSessionListUsage(),
				["Usage: oc session list", "Default limit: 20"],
			],
			[
				formatSessionSearchUsage(),
				["Usage: oc session search", "No default limit"],
			],
			[
				formatSessionTranscriptUsage(),
				["Usage: oc session transcript", "unique prefix"],
			],
		];

		for (const [usage, expectedSnippets] of cases) {
			expect(usage.endsWith("\n")).toBe(false);
			for (const snippet of expectedSnippets) {
				expect(usage).toContain(snippet);
			}
		}
	});

	test("print helpers write their corresponding formatted usage text", () => {
		const cases: Array<[() => void, () => string]> = [
			[printUsage, formatUsage],
			[printStartUsage, formatStartUsage],
			[printOnboardUsage, formatOnboardUsage],
			[printAgentUsage, formatAgentUsage],
			[printAgentListUsage, formatAgentListUsage],
			[printAgentCreateUsage, formatAgentCreateUsage],
			[printAgentConfigUsage, formatAgentConfigUsage],
			[printAgentRenameUsage, formatAgentRenameUsage],
			[printAgentRemoveUsage, formatAgentRemoveUsage],
			[printAgentAskUsage, formatAgentAskUsage],
			[printConfigUsage, formatConfigUsage],
			[printConfigRuntimeUsage, formatConfigRuntimeUsage],
			[printConfigSecureUsage, formatConfigSecureUsage],
			[printCronUsage, formatCronUsage],
			[printCronRunUsage, formatCronRunUsage],
			[printCronStatusUsage, formatCronStatusUsage],
			[printSchemaUsage, formatSchemaUsage],
			[printSchemaStatusUsage, formatSchemaStatusUsage],
			[printSessionUsage, formatSessionUsage],
			[printSessionListUsage, formatSessionListUsage],
			[printSessionSearchUsage, formatSessionSearchUsage],
			[printSessionTranscriptUsage, formatSessionTranscriptUsage],
		];

		for (const [print, format] of cases) {
			expect(capturePrint(print)).toBe(format());
		}
	});
});
