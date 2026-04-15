import { parse } from "yaml";

export interface CronJobConfig {
	name: string;
	schedule: string;
	model?: string;
	enabled: boolean;
	telegramUserId?: number;
	prompt: string;
}

export function parseJobConfig(yamlContent: string): CronJobConfig {
	const raw = parse(yamlContent);

	if (!raw?.name) throw new Error("Missing required field: name");
	if (!raw.schedule) throw new Error("Missing required field: schedule");
	if (!raw.prompt) throw new Error("Missing required field: prompt");

	return {
		name: raw.name,
		schedule: raw.schedule,
		model: raw.model ?? undefined,
		enabled: raw.enabled ?? true,
		telegramUserId:
			typeof raw.telegramUserId === "number" &&
			Number.isFinite(raw.telegramUserId)
				? raw.telegramUserId
				: undefined,
		prompt: raw.prompt,
	};
}
