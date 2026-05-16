import { describe, expect, test } from "bun:test";
import type { EffortLevel } from "../../../src/common/commands.ts";
import { CronExecutionPolicy } from "../../../src/runtime/cron/execution-policy.ts";
import type { CronJobConfig } from "../../../src/runtime/cron/job-config.ts";

function makeJob(config: Partial<CronJobConfig> = {}): {
	config: CronJobConfig;
	telegramChatId?: number;
} {
	return {
		config: {
			name: "test-job",
			schedule: "* * * * *",
			enabled: true,
			model: "opus",
			prompt: "say hello",
			...config,
		},
	};
}

describe("CronExecutionPolicy", () => {
	test("manual runs are accepted and overlap with an active prior run", () => {
		const started: string[] = [];
		const releases: Array<() => void> = [];
		const policy = new CronExecutionPolicy({
			getDefaultEffort: () => "medium",
			onResult: () => {},
			runAgent: async (prompt) => {
				started.push(prompt);
				await new Promise<void>((resolve) => {
					releases.push(resolve);
				});
				return "done";
			},
		});
		const job = makeJob();

		expect(policy.startManualRun("test-job", job)).toEqual({
			status: "accepted",
			jobName: "test-job",
		});
		expect(policy.startManualRun("test-job", job)).toEqual({
			status: "accepted",
			jobName: "test-job",
		});

		expect(started).toEqual(["say hello", "say hello"]);
		for (const release of releases) release();
	});

	test("manual start reports disabled and missing jobs without invoking the agent", () => {
		let called = false;
		const policy = new CronExecutionPolicy({
			getDefaultEffort: () => "medium",
			onResult: () => {},
			runAgent: async () => {
				called = true;
				return "done";
			},
		});

		expect(
			policy.startManualRun("disabled-job", undefined, {
				name: "disabled-job",
			}),
		).toEqual({
			status: "disabled",
			jobName: "disabled-job",
		});
		expect(policy.startManualRun("missing-job", undefined)).toEqual({
			status: "not_found",
			jobName: "missing-job",
		});
		expect(called).toBe(false);
	});

	test("has no app-level timeout unless a future policy adds one explicitly", async () => {
		const results: unknown[] = [];
		let releaseAgent: (() => void) | undefined;
		const policy = new CronExecutionPolicy({
			getDefaultEffort: () => "medium",
			onResult: (result) => {
				results.push(result);
			},
			runAgent: async () => {
				await new Promise<void>((resolve) => {
					releaseAgent = resolve;
				});
				return "eventual result";
			},
		});

		const run = policy.runScheduledJob(makeJob());
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(results).toEqual([]);

		releaseAgent?.();
		await run;

		expect(results).toMatchObject([{ text: "eventual result" }]);
	});

	test("suppresses NO_REPLY while preserving session metadata for persistence", async () => {
		const results: unknown[] = [];
		const policy = new CronExecutionPolicy({
			getDefaultEffort: () => "medium",
			onResult: (result) => {
				results.push(result);
			},
			runAgent: async () => ({
				sessionId: "cron-session-123",
				text: "`NO_REPLY`",
			}),
		});

		await policy.runScheduledJob({
			...makeJob({ model: "haiku" }),
			telegramChatId: 456,
		});

		expect(results).toEqual([
			{
				jobName: "test-job",
				model: "haiku",
				sessionId: "cron-session-123",
				suppressDelivery: true,
				telegramChatId: 456,
				text: "`NO_REPLY`",
			},
		]);
	});

	test("records failed runs with their cron session id and fallback result text", async () => {
		const results: unknown[] = [];
		const policy = new CronExecutionPolicy({
			getDefaultEffort: () => "medium",
			onResult: (result) => {
				results.push(result);
			},
			runAgent: async () => {
				throw Object.assign(new Error("agent exploded"), {
					sessionId: "cron-session-error",
				});
			},
		});

		await policy.runScheduledJob(makeJob());

		expect(results).toEqual([
			{
				failureMessage: "agent exploded",
				jobName: "test-job",
				model: "opus",
				persistResultText: true,
				sessionId: "cron-session-error",
				telegramChatId: undefined,
				text: "[error] agent exploded",
			},
		]);
	});

	test("synthesizes a cron session id when a failed run has none", async () => {
		const results: Array<{ sessionId?: string }> = [];
		const policy = new CronExecutionPolicy({
			getDefaultEffort: () => "medium",
			onResult: (result) => {
				results.push(result);
			},
			runAgent: async () => {
				throw new Error("agent exploded");
			},
		});

		await policy.runScheduledJob(makeJob());

		expect(results[0]?.sessionId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	test("passes cron effort values through without provider-specific normalization", async () => {
		const received: Array<{ model?: string; effort?: EffortLevel }> = [];
		const policy = new CronExecutionPolicy({
			getDefaultEffort: () => "xhigh",
			onResult: () => {},
			runAgent: async (_prompt, model, effort) => {
				received.push({ model, effort });
				return "done";
			},
		});

		await policy.runScheduledJob(makeJob({ model: "haiku" }));
		await policy.runScheduledJob(makeJob({ model: "opus", effort: "xhigh" }));

		expect(received).toEqual([
			{ model: "haiku", effort: "xhigh" },
			{ model: "opus", effort: "xhigh" },
		]);
	});
});
