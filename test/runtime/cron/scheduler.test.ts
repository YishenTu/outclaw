import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EffortLevel } from "../../../src/common/commands.ts";
import { CronScheduler } from "../../../src/runtime/cron/scheduler.ts";

interface ScheduledCronResult {
	jobName: string;
	model: string;
	sessionId?: string;
	suppressDelivery?: boolean;
	telegramChatId?: number;
	text: string;
}

function makeCronDir(): string {
	const dir = join(tmpdir(), `cron-test-${Date.now()}-${Math.random()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writeJob(cronDir: string, filename: string, content: string) {
	writeFileSync(join(cronDir, filename), content);
}

async function waitForWatcher() {
	await new Promise((resolve) => setTimeout(resolve, 50));
}

async function waitForCondition(
	check: () => boolean | Promise<boolean>,
	timeoutMs = 500,
) {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (await check()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	throw new Error("Timed out waiting for condition");
}

const SIMPLE_JOB = `
name: test-job
schedule: "* * * * *"
model: haiku
enabled: true
prompt: say hello
`.trim();

const DISABLED_JOB = `
name: disabled-job
schedule: "* * * * *"
enabled: false
prompt: should not run
`.trim();

const FUTURE_RUN_AT = "2999-01-23T09:00:00+00:00";

describe("CronScheduler", () => {
	const schedulers: CronScheduler[] = [];

	afterEach(() => {
		for (const s of schedulers) s.stop();
		schedulers.length = 0;
	});

	function createScheduler(
		cronDir: string,
		overrides: {
			runAgent?: (
				prompt: string,
				model?: string,
				effort?: EffortLevel,
			) => Promise<string | { text: string; sessionId?: string }>;
			onResult?: (event: ScheduledCronResult) => void;
			getDefaultModel?: () => string;
			getDefaultEffort?: () => EffortLevel;
			watchPollIntervalMs?: number;
			resolveTelegramChatId?: (config: {
				name: string;
				telegramUserId?: number;
			}) => number | undefined;
			watchDir?: (
				path: string,
				listener: (eventType: string, filename: string | Buffer | null) => void,
			) => ReturnType<typeof import("node:fs").watch>;
		} = {},
	) {
		const scheduler = new CronScheduler({
			cronDir,
			runAgent: overrides.runAgent ?? (async () => "agent response"),
			onResult: overrides.onResult ?? (() => {}),
			getDefaultModel: overrides.getDefaultModel ?? (() => "opus"),
			getDefaultEffort: overrides.getDefaultEffort ?? (() => "medium"),
			resolveTelegramChatId: overrides.resolveTelegramChatId,
			watchPollIntervalMs: overrides.watchPollIntervalMs ?? 10,
			watchDir: overrides.watchDir,
		});
		schedulers.push(scheduler);
		return scheduler;
	}

	test("loads jobs from cron directory on start", () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job1.yaml", SIMPLE_JOB);
		writeJob(cronDir, "job2.yaml", SIMPLE_JOB.replace("test-job", "job-2"));

		const scheduler = createScheduler(cronDir);
		scheduler.start();

		expect(scheduler.jobCount).toBe(2);
	});

	test("ignores non-yaml files", () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);
		writeJob(cronDir, "readme.md", "# not a job");
		writeJob(cronDir, "notes.txt", "just notes");

		const scheduler = createScheduler(cronDir);
		scheduler.start();

		expect(scheduler.jobCount).toBe(1);
	});

	test("ignores underscore-prefixed yaml files", () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);
		writeJob(cronDir, "_template.yaml", SIMPLE_JOB.replace("test-job", "tpl"));
		writeJob(cronDir, "_draft.yml", SIMPLE_JOB.replace("test-job", "draft"));

		const scheduler = createScheduler(cronDir);
		scheduler.start();

		expect(scheduler.jobCount).toBe(1);
	});

	test("unschedules a live job when it is renamed to an underscore-prefixed yaml file", async () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);

		const watcher = new EventEmitter() as ReturnType<
			typeof import("node:fs").watch
		>;
		watcher.close = () => {};
		const scheduler = createScheduler(cronDir, {
			watchDir: (_path, listener) => {
				watcher.on("change", (eventType, filename) => {
					listener(eventType, filename);
				});
				return watcher;
			},
		});
		scheduler.start();
		expect(scheduler.jobCount).toBe(1);

		rmSync(join(cronDir, "job.yaml"));
		writeJob(
			cronDir,
			"_job.yaml",
			SIMPLE_JOB.replace("test-job", "renamed-job"),
		);
		watcher.emit("change", "rename", "_job.yaml");
		await waitForCondition(() => scheduler.jobCount === 0);
	});

	test("skips disabled jobs", () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "active.yaml", SIMPLE_JOB);
		writeJob(cronDir, "disabled.yaml", DISABLED_JOB);

		const scheduler = createScheduler(cronDir);
		scheduler.start();

		expect(scheduler.jobCount).toBe(1);
	});

	test("loads future one-time runAt jobs", () => {
		const cronDir = makeCronDir();
		writeJob(
			cronDir,
			"once.yaml",
			`
name: one-time-job
runAt: "${FUTURE_RUN_AT}"
enabled: true
prompt: say hello once
				`.trim(),
		);

		const scheduler = createScheduler(cronDir);
		scheduler.start();

		expect(scheduler.jobCount).toBe(1);
	});

	test("does not schedule expired one-time runAt jobs", () => {
		const cronDir = makeCronDir();
		writeJob(
			cronDir,
			"expired.yaml",
			`
name: expired-job
runAt: "2000-01-23T09:00:00+00:00"
enabled: true
prompt: should not run on startup
				`.trim(),
		);

		const scheduler = createScheduler(cronDir);
		scheduler.start();

		expect(scheduler.jobCount).toBe(0);
	});

	test("handles empty cron directory", () => {
		const cronDir = makeCronDir();
		const scheduler = createScheduler(cronDir);
		scheduler.start();

		expect(scheduler.jobCount).toBe(0);
	});

	test("handles missing cron directory", () => {
		const cronDir = join(tmpdir(), `nonexistent-${Date.now()}`);
		const scheduler = createScheduler(cronDir);
		scheduler.start();

		expect(scheduler.jobCount).toBe(0);
	});

	test("logs warning for malformed YAML and skips", () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "bad.yaml", ":::invalid");
		writeJob(cronDir, "good.yaml", SIMPLE_JOB);

		const scheduler = createScheduler(cronDir);
		scheduler.start();

		expect(scheduler.jobCount).toBe(1);
	});

	test("fires job and delivers result via onResult", async () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);

		const results: ScheduledCronResult[] = [];
		const scheduler = createScheduler(cronDir, {
			runAgent: async () => ({
				sessionId: "cron-session-123",
				text: "hello from agent",
			}),
			onResult: (event) => results.push(event),
		});
		scheduler.start();

		await scheduler.triggerJob("test-job");

		expect(results).toEqual([
			{
				jobName: "test-job",
				model: "haiku",
				sessionId: "cron-session-123",
				telegramChatId: undefined,
				text: "hello from agent",
			},
		]);
	});

	test("starts a manual job run without waiting for the agent result", async () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);

		let releaseAgent: (() => void) | undefined;
		const agentReleased = new Promise<void>((resolve) => {
			releaseAgent = resolve;
		});
		const results: ScheduledCronResult[] = [];
		const scheduler = createScheduler(cronDir, {
			runAgent: async () => {
				await agentReleased;
				return "manual result";
			},
			onResult: (event) => results.push(event),
		});
		scheduler.start();

		const accepted = scheduler.startJob("test-job");

		expect(accepted).toEqual({ status: "accepted", jobName: "test-job" });
		expect(results).toEqual([]);

		releaseAgent?.();
		await waitForCondition(() => results.length === 1);

		expect(results[0]).toMatchObject({
			jobName: "test-job",
			text: "manual result",
		});
	});

	test("manual one-time job runs do not disable the config", async () => {
		const cronDir = makeCronDir();
		const cronPath = join(cronDir, "once.yaml");
		writeJob(
			cronDir,
			"once.yaml",
			`
name: one-time-job
runAt: "${FUTURE_RUN_AT}"
enabled: true
prompt: say hello once
				`.trim(),
		);

		const results: ScheduledCronResult[] = [];
		const scheduler = createScheduler(cronDir, {
			runAgent: async () => "manual one-time result",
			onResult: (event) => results.push(event),
		});
		scheduler.start();

		const accepted = scheduler.startJob("one-time-job");

		expect(accepted).toEqual({ status: "accepted", jobName: "one-time-job" });
		await waitForCondition(() => results.length === 1);
		expect(readFileSync(cronPath, "utf8")).toContain("enabled: true");
	});

	test("scheduled one-time job disables itself after the scheduled attempt starts", async () => {
		const cronDir = makeCronDir();
		const cronPath = join(cronDir, "once.yaml");
		const runAt = new Date(Date.now() + 1500).toISOString();
		writeJob(
			cronDir,
			"once.yaml",
			`
name: one-time-job
runAt: "${runAt}"
enabled: true
prompt: say hello once
				`.trim(),
		);

		let called = false;
		const scheduler = createScheduler(cronDir, {
			runAgent: async () => {
				called = true;
				return "scheduled one-time result";
			},
		});
		scheduler.start();

		await waitForCondition(() => called, 3000);
		expect(readFileSync(cronPath, "utf8")).toContain("enabled: false");
	});

	test("rejects a disabled manual job run before invoking the agent", () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", DISABLED_JOB);

		let called = false;
		const scheduler = createScheduler(cronDir, {
			runAgent: async () => {
				called = true;
				return "should not run";
			},
		});
		scheduler.start();

		expect(scheduler.startJob("disabled-job")).toEqual({
			status: "disabled",
			jobName: "disabled-job",
		});
		expect(called).toBe(false);
	});

	test("reports a missing manual job run by name", () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);

		const scheduler = createScheduler(cronDir);
		scheduler.start();

		expect(scheduler.startJob("missing-job")).toEqual({
			status: "not_found",
			jobName: "missing-job",
		});
	});

	test("includes the resolved telegram chat id in cron results", async () => {
		const cronDir = makeCronDir();
		writeJob(
			cronDir,
			"job.yaml",
			`
name: notify-job
schedule: "* * * * *"
telegramUserId: 456
prompt: say hello
				`.trim(),
		);

		const results: ScheduledCronResult[] = [];
		const scheduler = createScheduler(cronDir, {
			onResult: (event) => results.push(event),
			resolveTelegramChatId: (config) => config.telegramUserId,
		});
		scheduler.start();

		await scheduler.triggerJob("notify-job");

		expect(results).toEqual([
			{
				jobName: "notify-job",
				model: "opus",
				sessionId: undefined,
				telegramChatId: 456,
				text: "agent response",
			},
		]);
	});

	test("passes model to runAgent", async () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);

		let receivedModel: string | undefined;
		const scheduler = createScheduler(cronDir, {
			runAgent: async (_prompt, model) => {
				receivedModel = model;
				return "ok";
			},
		});
		scheduler.start();

		await scheduler.triggerJob("test-job");

		expect(receivedModel).toBe("haiku");
	});

	test("passes explicit effort to runAgent", async () => {
		const cronDir = makeCronDir();
		writeJob(
			cronDir,
			"job.yaml",
			`
name: focused-job
schedule: "* * * * *"
model: opus
effort: max
prompt: do something
		`.trim(),
		);

		let receivedEffort: string | undefined;
		const scheduler = createScheduler(cronDir, {
			runAgent: async (_prompt, _model, effort) => {
				receivedEffort = effort;
				return "ok";
			},
		});
		scheduler.start();

		await scheduler.triggerJob("focused-job");

		expect(receivedEffort).toBe("max");
	});

	test("keeps xhigh effort for opus cron jobs", async () => {
		const cronDir = makeCronDir();
		writeJob(
			cronDir,
			"job.yaml",
			`
name: opus-job
schedule: "* * * * *"
model: opus
effort: xhigh
prompt: do something
		`.trim(),
		);

		let receivedEffort: string | undefined;
		const scheduler = createScheduler(cronDir, {
			runAgent: async (_prompt, _model, effort) => {
				receivedEffort = effort;
				return "ok";
			},
		});
		scheduler.start();

		await scheduler.triggerJob("opus-job");

		expect(receivedEffort).toBe("xhigh");
	});

	test("falls back to high when a non-opus cron job requests xhigh", async () => {
		const cronDir = makeCronDir();
		writeJob(
			cronDir,
			"job.yaml",
			`
name: haiku-job
schedule: "* * * * *"
model: haiku
effort: xhigh
prompt: do something
		`.trim(),
		);

		let receivedEffort: string | undefined;
		const scheduler = createScheduler(cronDir, {
			runAgent: async (_prompt, _model, effort) => {
				receivedEffort = effort;
				return "ok";
			},
		});
		scheduler.start();

		await scheduler.triggerJob("haiku-job");

		expect(receivedEffort).toBe("high");
	});

	test("uses default model when job has no model", async () => {
		const cronDir = makeCronDir();
		const noModelJob = `
name: no-model-job
schedule: "* * * * *"
prompt: do something
`.trim();
		writeJob(cronDir, "job.yaml", noModelJob);

		let receivedModel: string | undefined;
		const scheduler = createScheduler(cronDir, {
			runAgent: async (_prompt, model) => {
				receivedModel = model;
				return "ok";
			},
			getDefaultModel: () => "sonnet",
		});
		scheduler.start();

		await scheduler.triggerJob("no-model-job");

		expect(receivedModel).toBe("sonnet");
	});

	test("uses default effort when job has no effort", async () => {
		const cronDir = makeCronDir();
		const noEffortJob = `
name: no-effort-job
schedule: "* * * * *"
prompt: do something
	`.trim();
		writeJob(cronDir, "job.yaml", noEffortJob);

		let receivedEffort: string | undefined;
		const scheduler = createScheduler(cronDir, {
			runAgent: async (_prompt, _model, effort) => {
				receivedEffort = effort;
				return "ok";
			},
			getDefaultEffort: () => "low",
		});
		scheduler.start();

		await scheduler.triggerJob("no-effort-job");

		expect(receivedEffort).toBe("low");
	});

	test("falls back to high when default effort is xhigh for a non-opus model", async () => {
		const cronDir = makeCronDir();
		const noEffortJob = `
name: default-haiku-job
schedule: "* * * * *"
model: haiku
prompt: do something
	`.trim();
		writeJob(cronDir, "job.yaml", noEffortJob);

		let receivedEffort: string | undefined;
		const scheduler = createScheduler(cronDir, {
			runAgent: async (_prompt, _model, effort) => {
				receivedEffort = effort;
				return "ok";
			},
			getDefaultEffort: () => "xhigh",
		});
		scheduler.start();

		await scheduler.triggerJob("default-haiku-job");

		expect(receivedEffort).toBe("high");
	});

	test("marks NO_REPLY results as suppressed completions", async () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);

		const results: ScheduledCronResult[] = [];
		const scheduler = createScheduler(cronDir, {
			runAgent: async () => ({
				sessionId: "cron-session-123",
				text: "NO_REPLY",
			}),
			onResult: (event) => results.push(event),
		});
		scheduler.start();

		await scheduler.triggerJob("test-job");

		expect(results).toEqual([
			{
				jobName: "test-job",
				model: "haiku",
				sessionId: "cron-session-123",
				suppressDelivery: true,
				telegramChatId: undefined,
				text: "",
			},
		]);
	});

	test("marks legacy no_reply results as suppressed completions", async () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);

		const results: ScheduledCronResult[] = [];
		const scheduler = createScheduler(cronDir, {
			runAgent: async () => " no_reply ",
			onResult: (event) => results.push(event),
		});
		scheduler.start();

		await scheduler.triggerJob("test-job");

		expect(results).toEqual([
			{
				jobName: "test-job",
				model: "haiku",
				suppressDelivery: true,
				telegramChatId: undefined,
				text: "",
			},
		]);
	});

	test("marks backtick-wrapped NO_REPLY results as suppressed completions", async () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);

		const results: ScheduledCronResult[] = [];
		const scheduler = createScheduler(cronDir, {
			runAgent: async () => "`NO_REPLY`",
			onResult: (event) => results.push(event),
		});
		scheduler.start();

		await scheduler.triggerJob("test-job");

		expect(results).toEqual([
			{
				jobName: "test-job",
				model: "haiku",
				suppressDelivery: true,
				telegramChatId: undefined,
				text: "",
			},
		]);
	});

	test("delivers error results when agent fails", async () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);

		const results: ScheduledCronResult[] = [];
		const scheduler = createScheduler(cronDir, {
			runAgent: async () => {
				throw new Error("agent exploded");
			},
			onResult: (event) => results.push(event),
		});
		scheduler.start();

		await scheduler.triggerJob("test-job");

		expect(results).toHaveLength(1);
		expect(results[0]?.jobName).toBe("test-job");
		expect(results[0]?.text).toContain("agent exploded");
	});

	test("replaces a renamed job when the same file changes", async () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);

		const prompts: string[] = [];
		const scheduler = createScheduler(cronDir, {
			runAgent: async (prompt) => {
				prompts.push(prompt);
				return { text: "ok", sessionId: "cron-session-1" };
			},
		});
		scheduler.start();
		await waitForWatcher();

		writeJob(
			cronDir,
			"job.yaml",
			SIMPLE_JOB.replace("name: test-job", "name: renamed-job").replace(
				"prompt: say hello",
				"prompt: say goodbye",
			),
		);
		await waitForCondition(async () => {
			prompts.length = 0;
			await scheduler.triggerJob("renamed-job");
			return prompts.at(-1) === "say goodbye";
		});
		prompts.length = 0;

		await scheduler.triggerJob("test-job");
		await scheduler.triggerJob("renamed-job");

		expect(scheduler.jobCount).toBe(1);
		expect(prompts).toEqual(["say goodbye"]);
	});

	test("removes deleted jobs by file identity, not job name", async () => {
		const cronDir = makeCronDir();
		writeJob(
			cronDir,
			"summary.yaml",
			SIMPLE_JOB.replace("name: test-job", "name: daily-summary"),
		);

		const scheduler = createScheduler(cronDir);
		scheduler.start();
		expect(scheduler.jobCount).toBe(1);

		rmSync(join(cronDir, "summary.yaml"));
		await waitForWatcher();

		expect(scheduler.jobCount).toBe(0);
	});

	test("recovers from watcher ENOENT by resyncing jobs from disk", async () => {
		const cronDir = makeCronDir();
		writeJob(
			cronDir,
			"summary.yaml",
			SIMPLE_JOB.replace("name: test-job", "name: daily-summary"),
		);

		class FakeWatcher extends EventEmitter {
			close() {}
		}

		const watcher = new FakeWatcher();
		const scheduler = createScheduler(cronDir, {
			watchDir: (_path, _listener) =>
				watcher as unknown as ReturnType<typeof import("node:fs").watch>,
		});
		scheduler.start();
		expect(scheduler.jobCount).toBe(1);

		rmSync(join(cronDir, "summary.yaml"));
		watcher.emit(
			"error",
			Object.assign(new Error("no such file or directory"), {
				code: "ENOENT",
			}),
		);

		await waitForCondition(() => scheduler.jobCount === 0);
		expect(scheduler.jobCount).toBe(0);
	});

	test("loads jobs with an explicit UTC offset timezone", () => {
		const cronDir = makeCronDir();
		writeJob(
			cronDir,
			"job.yaml",
			`
name: tz-job
schedule: "0 9 * * *"
timezone: UTC+8
prompt: say hello
				`.trim(),
		);

		const scheduler = createScheduler(cronDir);
		scheduler.start();

		expect(scheduler.jobCount).toBe(1);
	});

	test("skips jobs whose timezone is invalid", () => {
		const cronDir = makeCronDir();
		writeJob(
			cronDir,
			"bad-tz.yaml",
			`
name: bad-tz-job
schedule: "0 9 * * *"
timezone: America/New_York
prompt: say hello
				`.trim(),
		);

		const scheduler = createScheduler(cronDir);
		scheduler.start();

		expect(scheduler.jobCount).toBe(0);
	});

	test("stop cleans up all jobs", () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);

		const scheduler = createScheduler(cronDir);
		scheduler.start();
		expect(scheduler.jobCount).toBe(1);

		scheduler.stop();
		expect(scheduler.jobCount).toBe(0);
	});
});
