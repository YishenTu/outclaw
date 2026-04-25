import { parse, stringify } from "yaml";
import {
	EFFORT_LEVELS,
	type EffortLevel,
	isEffortLevel,
} from "../../common/commands.ts";

export interface CronJobConfig {
	name: string;
	schedule: string;
	model?: string;
	effort?: EffortLevel;
	enabled: boolean;
	telegramUserId?: number;
	timezone?: string;
	prompt: string;
}

export function parseJobConfig(yamlContent: string): CronJobConfig {
	const raw = parse(yamlContent);

	if (!raw?.name) throw new Error("Missing required field: name");
	if (!raw.schedule) throw new Error("Missing required field: schedule");
	if (!raw.prompt) throw new Error("Missing required field: prompt");
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

	return {
		name: raw.name,
		schedule: raw.schedule,
		model: raw.model ?? undefined,
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

export function serializeJobConfig(config: CronJobConfig): string {
	const raw: Record<string, unknown> = {
		name: config.name,
		schedule: config.schedule,
	};

	if (config.model) {
		raw.model = config.model;
	}

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
