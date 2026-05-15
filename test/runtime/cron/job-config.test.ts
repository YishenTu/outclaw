import { describe, expect, test } from "bun:test";
import {
	parseJobConfig,
	serializeJobConfig,
} from "../../../src/runtime/cron/job-config.ts";

const VALID_YAML = `
name: daily-summary
schedule: "0 9 * * *"
model: haiku
enabled: true
prompt: |
  Summarize yesterday's activity.
  If nothing noteworthy, reply NO_REPLY.
`.trim();

describe("parseJobConfig", () => {
	test("parses a valid YAML job config", () => {
		const job = parseJobConfig(VALID_YAML);
		expect(job).toEqual({
			name: "daily-summary",
			schedule: "0 9 * * *",
			model: "haiku",
			enabled: true,
			prompt:
				"Summarize yesterday's activity.\nIf nothing noteworthy, reply NO_REPLY.\n",
		});
	});

	test("defaults enabled to true when omitted", () => {
		const yaml = `
name: test-job
schedule: "*/5 * * * *"
model: haiku
prompt: do something
`.trim();
		const job = parseJobConfig(yaml);
		expect(job.enabled).toBe(true);
	});

	test("requires an explicit model because cron uses it to resolve provider", () => {
		const yaml = `
name: test-job
schedule: "*/5 * * * *"
prompt: do something
			`.trim();
		expect(() => parseJobConfig(yaml)).toThrow("Missing required field: model");
	});

	test("rejects unknown or ambiguous cron models", () => {
		const yaml = `
name: test-job
schedule: "*/5 * * * *"
model: gpt-unknown
prompt: do something
		`.trim();
		expect(() => parseJobConfig(yaml)).toThrow("Invalid model: gpt-unknown");
	});

	test("accepts the MVP Codex cron model gpt-5.5", () => {
		const yaml = `
name: codex-cron
schedule: "*/5 * * * *"
model: gpt-5.5
prompt: do something
		`.trim();
		const job = parseJobConfig(yaml);
		expect(job.model).toBe("gpt-5.5");
	});

	test("parses a one-time runAt job config", () => {
		const yaml = `
name: one-time-job
runAt: "2026-04-29T09:00:00+08:00"
model: haiku
prompt: do something once
		`.trim();
		const job = parseJobConfig(yaml);
		expect(job).toEqual({
			name: "one-time-job",
			runAt: "2026-04-29T09:00:00+08:00",
			model: "haiku",
			enabled: true,
			prompt: "do something once",
		});
	});

	test("throws when both schedule and runAt are provided", () => {
		const yaml = `
name: ambiguous-job
schedule: "0 9 * * *"
runAt: "2026-04-29T09:00:00+08:00"
prompt: do something
		`.trim();
		expect(() => parseJobConfig(yaml)).toThrow(
			"Provide exactly one of schedule or runAt",
		);
	});

	test("throws when schedule is empty", () => {
		const yaml = `
name: empty-schedule-job
schedule: ""
prompt: do something
		`.trim();
		expect(() => parseJobConfig(yaml)).toThrow(
			"schedule must be a non-empty string",
		);
	});

	test("throws when runAt omits an explicit timezone offset", () => {
		const yaml = `
name: ambiguous-time-job
runAt: "2026-04-29T09:00:00"
model: haiku
prompt: do something
		`.trim();
		expect(() => parseJobConfig(yaml)).toThrow(
			"runAt must be an ISO 8601 datetime with explicit Z or offset",
		);
	});

	test("throws when timezone is provided for runAt", () => {
		const yaml = `
name: one-time-job
runAt: "2026-04-29T09:00:00+08:00"
timezone: UTC+8
prompt: do something
		`.trim();
		expect(() => parseJobConfig(yaml)).toThrow(
			"timezone can only be used with schedule",
		);
	});

	test("parses thinking effort when provided", () => {
		const yaml = `
name: test-job
schedule: "*/5 * * * *"
model: haiku
effort: high
prompt: do something
		`.trim();
		const job = parseJobConfig(yaml);
		expect(job.effort).toBe("high");
	});

	test("defaults effort to undefined when omitted", () => {
		const yaml = `
name: test-job
schedule: "*/5 * * * *"
model: haiku
prompt: do something
		`.trim();
		const job = parseJobConfig(yaml);
		expect(job.effort).toBeUndefined();
	});

	test("throws when effort is invalid", () => {
		const yaml = `
name: test-job
schedule: "*/5 * * * *"
model: haiku
effort: turbo
prompt: do something
		`.trim();
		expect(() => parseJobConfig(yaml)).toThrow(
			"Invalid effort: turbo. Valid: low, medium, high, xhigh, max",
		);
	});

	test("parses timezone when provided", () => {
		const yaml = `
name: tz-job
schedule: "0 9 * * *"
model: haiku
timezone: UTC+8
prompt: do something
		`.trim();
		const job = parseJobConfig(yaml);
		expect(job.timezone).toBe("UTC+8");
	});

	test("accepts plain UTC", () => {
		const yaml = `
name: tz-job
schedule: "0 9 * * *"
model: haiku
timezone: UTC
prompt: do something
		`.trim();
		const job = parseJobConfig(yaml);
		expect(job.timezone).toBe("UTC");
	});

	test("defaults timezone to undefined when omitted", () => {
		const yaml = `
name: test-job
schedule: "*/5 * * * *"
model: haiku
prompt: do something
		`.trim();
		const job = parseJobConfig(yaml);
		expect(job.timezone).toBeUndefined();
	});

	test("rejects IANA timezone names", () => {
		const yaml = `
name: test-job
schedule: "*/5 * * * *"
model: haiku
timezone: America/New_York
prompt: do something
		`.trim();
		expect(() => parseJobConfig(yaml)).toThrow("Invalid timezone");
	});

	test("throws when timezone is malformed", () => {
		const yaml = `
name: test-job
schedule: "*/5 * * * *"
model: haiku
timezone: UTC+99
prompt: do something
		`.trim();
		expect(() => parseJobConfig(yaml)).toThrow("Invalid timezone");
	});

	test("parses telegramUserId when provided", () => {
		const yaml = `
name: notify-job
schedule: "*/5 * * * *"
model: haiku
telegramUserId: 123
prompt: do something
	`.trim();
		const job = parseJobConfig(yaml);
		expect(job.telegramUserId).toBe(123);
	});

	test("throws when name is missing", () => {
		const yaml = `
schedule: "0 9 * * *"
prompt: do something
`.trim();
		expect(() => parseJobConfig(yaml)).toThrow("name");
	});

	test("throws when schedule is missing", () => {
		const yaml = `
name: test-job
prompt: do something
`.trim();
		expect(() => parseJobConfig(yaml)).toThrow("schedule or runAt");
	});

	test("throws when prompt is missing", () => {
		const yaml = `
name: test-job
schedule: "0 9 * * *"
`.trim();
		expect(() => parseJobConfig(yaml)).toThrow("prompt");
	});

	test("throws on invalid YAML", () => {
		expect(() => parseJobConfig(":::invalid")).toThrow();
	});

	test("allows enabled to be false", () => {
		const yaml = `
name: disabled-job
schedule: "0 9 * * *"
model: haiku
enabled: false
prompt: do something
`.trim();
		const job = parseJobConfig(yaml);
		expect(job.enabled).toBe(false);
	});

	test("serializes a parsed config back to equivalent YAML", () => {
		const parsed = parseJobConfig(`${VALID_YAML}\neffort: xhigh`);
		const reparsed = parseJobConfig(serializeJobConfig(parsed));

		expect(reparsed).toEqual(parsed);
	});

	test("round-trips timezone through serialize", () => {
		const parsed = parseJobConfig(`${VALID_YAML}\ntimezone: UTC-7`);
		const reparsed = parseJobConfig(serializeJobConfig(parsed));
		expect(reparsed.timezone).toBe("UTC-7");
	});

	test("round-trips runAt through serialize", () => {
		const parsed = parseJobConfig(
			`
name: one-time-job
runAt: "2026-04-29T09:00:00+08:00"
model: haiku
enabled: true
prompt: do something once
		`.trim(),
		);
		const reparsed = parseJobConfig(serializeJobConfig(parsed));
		expect(reparsed).toEqual(parsed);
	});
});
