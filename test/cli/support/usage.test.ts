import { describe, expect, test } from "bun:test";
import {
	formatOnboardUsage,
	formatStartUsage,
	formatUsage,
	hasHelpFlag,
	isHelpFlag,
	printOnboardUsage,
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
		expect(hasHelpFlag(["start", "--help"])).toBe(true);
		expect(hasHelpFlag(["start"])).toBe(false);
	});

	test("formats the operator-only command contract", () => {
		const usage = formatUsage();

		expect(usage).toContain(
			"Usage: oc <start|stop|restart|status|tui|browser|onboard|dev|build>",
		);
		expect(usage).toContain("oc build && oc start");
		expect(usage).toContain("command help: oc <command> -h");
		for (const removed of [
			"oc agent",
			"oc config",
			"oc coding",
			"oc session",
			"oc cron",
			"oc note",
			"oc schema",
		]) {
			expect(usage).not.toContain(removed);
		}
	});

	test("formats retained command help", () => {
		expect(formatStartUsage()).toContain(
			"Usage: oc start [--lan] [--host HOST]",
		);
		expect(formatStartUsage()).toContain("oc restart --host");
		expect(formatOnboardUsage()).toContain("Usage: oc onboard");
		expect(formatOnboardUsage()).toContain("interactive agent onboarding TUI");
	});

	test("print helpers write their corresponding formatted usage text", () => {
		const cases: Array<[() => void, () => string]> = [
			[printUsage, formatUsage],
			[printStartUsage, formatStartUsage],
			[printOnboardUsage, formatOnboardUsage],
		];

		for (const [print, format] of cases) {
			expect(capturePrint(print)).toBe(format());
		}
	});
});
