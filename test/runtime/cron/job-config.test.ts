import { describe, expect, test } from "bun:test";
import { parseJobConfig } from "../../../src/runtime/cron/job-config.ts";

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
prompt: do something
`.trim();
		const job = parseJobConfig(yaml);
		expect(job.enabled).toBe(true);
	});

	test("defaults model to undefined when omitted", () => {
		const yaml = `
name: test-job
schedule: "*/5 * * * *"
prompt: do something
	`.trim();
		const job = parseJobConfig(yaml);
		expect(job.model).toBeUndefined();
	});

	test("parses telegramUserId when provided", () => {
		const yaml = `
name: notify-job
schedule: "*/5 * * * *"
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
		expect(() => parseJobConfig(yaml)).toThrow("schedule");
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
enabled: false
prompt: do something
`.trim();
		const job = parseJobConfig(yaml);
		expect(job.enabled).toBe(false);
	});
});
