import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CronScheduler } from "../../../src/runtime/cron/scheduler.ts";

interface ScheduledCronResult {
	jobName: string;
	model: string;
	sessionId?: string;
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
			) => Promise<string | { text: string; sessionId?: string }>;
			onResult?: (event: ScheduledCronResult) => void;
			getDefaultModel?: () => string;
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
			resolveTelegramChatId: overrides.resolveTelegramChatId,
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

	test("skips disabled jobs", () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "active.yaml", SIMPLE_JOB);
		writeJob(cronDir, "disabled.yaml", DISABLED_JOB);

		const scheduler = createScheduler(cronDir);
		scheduler.start();

		expect(scheduler.jobCount).toBe(1);
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
			runAgent: async () => "hello from agent",
			onResult: (event) => results.push(event),
		});
		scheduler.start();

		await scheduler.triggerJob("test-job");

		expect(results).toEqual([
			{
				jobName: "test-job",
				model: "haiku",
				sessionId: undefined,
				telegramChatId: undefined,
				text: "hello from agent",
			},
		]);
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

	test("suppresses NO_REPLY results", async () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);

		const results: ScheduledCronResult[] = [];
		const scheduler = createScheduler(cronDir, {
			runAgent: async () => "NO_REPLY",
			onResult: (event) => results.push(event),
		});
		scheduler.start();

		await scheduler.triggerJob("test-job");

		expect(results).toEqual([]);
	});

	test("suppresses legacy no_reply results", async () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);

		const results: ScheduledCronResult[] = [];
		const scheduler = createScheduler(cronDir, {
			runAgent: async () => " no_reply ",
			onResult: (event) => results.push(event),
		});
		scheduler.start();

		await scheduler.triggerJob("test-job");

		expect(results).toEqual([]);
	});

	test("suppresses backtick-wrapped NO_REPLY results", async () => {
		const cronDir = makeCronDir();
		writeJob(cronDir, "job.yaml", SIMPLE_JOB);

		const results: ScheduledCronResult[] = [];
		const scheduler = createScheduler(cronDir, {
			runAgent: async () => "`NO_REPLY`",
			onResult: (event) => results.push(event),
		});
		scheduler.start();

		await scheduler.triggerJob("test-job");

		expect(results).toEqual([]);
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
