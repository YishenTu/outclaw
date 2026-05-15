import { parse, stringify } from "yaml";
import {
	EFFORT_LEVELS,
	type EffortLevel,
	isEffortLevel,
} from "../../common/commands.ts";
import { isModelAlias } from "../../common/models.ts";
import { validateRunAt } from "./schedule.ts";

export interface CronJobConfig {
	name: string;
	schedule?: string;
	runAt?: string;
	/**
	 * Model id. Cron has no provider field, so this field is required and must
	 * resolve to exactly one provider through the chat model catalog. A Claude
	 * alias (`opus`/`sonnet`/`haiku`) routes to Claude; a recognized Codex model
	 * id (e.g. `gpt-5.5`) routes to Codex. Unknown or ambiguous values are
	 * rejected at parse time.
	 */
	model: string;
	effort?: EffortLevel;
	enabled: boolean;
	telegramUserId?: number;
	timezone?: string;
	prompt: string;
}

export function parseJobConfig(yamlContent: string): CronJobConfig {
	const raw = parse(yamlContent);

	if (!raw?.name) throw new Error("Missing required field: name");
	const hasSchedule = raw.schedule !== undefined && raw.schedule !== null;
	const hasRunAt = raw.runAt !== undefined && raw.runAt !== null;
	if (hasSchedule === hasRunAt) {
		throw new Error("Provide exactly one of schedule or runAt");
	}
	if (!raw.prompt) throw new Error("Missing required field: prompt");
	if (hasRunAt && raw.timezone !== undefined) {
		throw new Error("timezone can only be used with schedule");
	}
	if (
		hasSchedule &&
		(typeof raw.schedule !== "string" || raw.schedule.trim() === "")
	) {
		throw new Error("schedule must be a non-empty string");
	}
	if (raw.effort !== undefined && !isEffortLevel(raw.effort)) {
		throw new Error(
			`Invalid effort: ${raw.effort}. Valid: ${EFFORT_LEVELS.join(", ")}`,
		);
	}
	if (
		raw.timezone !== undefined &&
		parseUtcOffsetHours(raw.timezone) === null
	) {
		throw new Error(
			`Invalid timezone: ${raw.timezone}. Use "UTC", "UTC+8", or "UTC-7".`,
		);
	}
	if (raw.model === undefined || raw.model === null) {
		throw new Error("Missing required field: model");
	}
	if (typeof raw.model !== "string" || raw.model === "") {
		throw new Error("Invalid model: must be a non-empty string");
	}
	if (!resolvesToKnownProvider(raw.model)) {
		throw new Error(
			`Invalid model: ${raw.model}. Use a Claude alias (opus, sonnet, haiku) or a recognized Codex model id (gpt-5.5).`,
		);
	}

	return {
		name: raw.name,
		schedule: hasSchedule ? raw.schedule : undefined,
		runAt: hasRunAt ? validateRunAt(raw.runAt) : undefined,
		model: raw.model,
		effort: raw.effort ?? undefined,
		enabled: raw.enabled ?? true,
		telegramUserId:
			typeof raw.telegramUserId === "number" &&
			Number.isFinite(raw.telegramUserId)
				? raw.telegramUserId
				: undefined,
		timezone: raw.timezone ?? undefined,
		prompt: raw.prompt,
	};
}

/**
 * Parses a timezone string in the form "UTC", "UTC+N", or "UTC-N" (N in 0..14).
 * Returns the offset in hours, or null if invalid.
 */
export function parseUtcOffsetHours(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const match = value.trim().match(/^UTC(?:([+-])(\d{1,2}))?$/i);
	if (!match) return null;
	if (!match[1]) return 0;
	const hours = Number.parseInt(match[2] ?? "", 10);
	if (!Number.isFinite(hours) || hours < 0 || hours > 14) return null;
	return match[1] === "-" ? -hours : hours;
}

function resolvesToKnownProvider(model: string): boolean {
	if (isModelAlias(model)) {
		return true;
	}
	// MVP Codex catalog mirror — only `gpt-5.5` is verified through
	// `model/list`. When the chat model catalog gains broader Codex routing,
	// this guard can defer to that catalog instead.
	return model === "gpt-5.5";
}

export function serializeJobConfig(config: CronJobConfig): string {
	const raw: Record<string, unknown> = {
		name: config.name,
	};

	if (config.schedule !== undefined) {
		raw.schedule = config.schedule;
	} else if (config.runAt !== undefined) {
		raw.runAt = config.runAt;
	}

	raw.model = config.model;

	if (config.effort) {
		raw.effort = config.effort;
	}

	raw.enabled = config.enabled;

	if (config.telegramUserId !== undefined) {
		raw.telegramUserId = config.telegramUserId;
	}

	if (config.timezone) {
		raw.timezone = config.timezone;
	}

	raw.prompt = config.prompt;

	return `${stringify(raw).trimEnd()}\n`;
}
