import type { Dirent } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isCronJobFile } from "../../../common/cron-job-file.ts";
import type { BrowserCronEntry } from "../../../common/protocol.ts";
import { parseJobConfig, serializeJobConfig } from "../../cron/job-config.ts";
import { isRunAtExpired, resolveJobSchedule } from "../../cron/schedule.ts";
import {
	resolveExistingPathWithinCronDirectory,
	toRelativePath,
} from "../paths/path-safety.ts";

export async function listCronEntries(
	rootDir: string,
): Promise<BrowserCronEntry[]> {
	const cronDir = resolve(rootDir, "cron");
	let entries: Dirent[];
	try {
		entries = await readdir(cronDir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}

	const cronFiles = entries
		.filter((entry) => entry.isFile() && isCronJobFile(entry.name))
		.sort((left, right) => left.name.localeCompare(right.name));

	return await Promise.all(
		cronFiles.map(async (entry) => {
			const absolutePath = resolve(cronDir, entry.name);
			const content = await readFile(absolutePath, "utf8");
			try {
				const config = parseJobConfig(content);
				return toBrowserCronEntry(rootDir, absolutePath, config);
			} catch (error) {
				return {
					name: entry.name,
					path: toRelativePath(rootDir, absolutePath),
					schedule: "Invalid config",
					enabled: false,
					status: "invalid",
					error:
						error instanceof Error ? error.message : "Failed to parse cron job",
				};
			}
		}),
	);
}

export async function setCronEnabled(
	rootDir: string,
	relativePath: string,
	enabled: boolean,
): Promise<BrowserCronEntry> {
	const absolutePath = resolveExistingPathWithinCronDirectory(
		rootDir,
		relativePath,
	);
	const content = await readFile(absolutePath, "utf8");
	const config = parseJobConfig(content);
	const nextConfig = { ...config, enabled };
	await writeFile(absolutePath, serializeJobConfig(nextConfig), "utf8");
	return toBrowserCronEntry(rootDir, absolutePath, nextConfig);
}

export function toBrowserCronEntry(
	rootDir: string,
	absolutePath: string,
	config: {
		effort?: string;
		enabled: boolean;
		model?: string;
		name: string;
		schedule?: string;
		runAt?: string;
		timezone?: string;
	},
): BrowserCronEntry {
	const schedule = resolveJobSchedule(config);
	const entry: BrowserCronEntry = {
		name: config.name,
		path: toRelativePath(rootDir, absolutePath),
		schedule: schedule.kind === "once" ? schedule.runAt : schedule.expression,
		scheduleKind: schedule.kind,
		enabled: config.enabled,
		status: resolveBrowserCronStatus(config.enabled, schedule),
	};

	if (config.timezone !== undefined) {
		entry.timezone = config.timezone;
	}
	if (schedule.kind === "once") {
		entry.runAt = schedule.runAt;
	}
	if (config.model !== undefined) {
		entry.model = config.model;
	}
	if (config.effort !== undefined) {
		entry.effort = config.effort;
	}

	return entry;
}

function resolveBrowserCronStatus(
	enabled: boolean,
	schedule: ReturnType<typeof resolveJobSchedule>,
): BrowserCronEntry["status"] {
	if (!enabled) {
		return "disabled";
	}

	if (schedule.kind === "once" && isRunAtExpired(schedule.runAt)) {
		return "expired";
	}

	return "scheduled";
}
