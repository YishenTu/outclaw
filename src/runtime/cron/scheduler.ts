import { existsSync, readdirSync, readFileSync, watch } from "node:fs";
import { join } from "node:path";
import { Cron } from "croner";
import { type EffortLevel, isOpusOnlyEffort } from "../../common/commands.ts";
import {
	hasCronJobExtension,
	isCronJobFile,
} from "../../common/cron-job-file.ts";
import { MODELS, resolveModelAlias } from "../../common/models.ts";
import { extractError } from "../../common/protocol.ts";
import {
	type CronJobConfig,
	parseJobConfig,
	parseUtcOffsetHours,
} from "./job-config.ts";

interface CronAgentRunResult {
	sessionId?: string;
	text: string;
}

interface CronExecutionResult {
	jobName: string;
	model: string;
	sessionId?: string;
	suppressDelivery?: boolean;
	telegramChatId?: number;
	text: string;
}

export type CronRunStartResult =
	| {
			status: "accepted";
			jobName: string;
	  }
	| {
			status: "disabled";
			jobName: string;
	  }
	| {
			status: "not_found";
			jobName: string;
	  };

interface CronSchedulerOptions {
	cronDir: string;
	runAgent: (
		prompt: string,
		model?: string,
		effort?: EffortLevel,
	) => Promise<string | CronAgentRunResult>;
	onResult: (result: CronExecutionResult) => Promise<void> | void;
	getDefaultModel: () => string;
	getDefaultEffort: () => EffortLevel;
	resolveTelegramChatId?: (config: CronJobConfig) => number | undefined;
	watchPollIntervalMs?: number;
	watchDir?: (
		path: string,
		listener: (eventType: string, filename: string | Buffer | null) => void,
	) => ReturnType<typeof watch>;
}

interface ActiveJob {
	filename: string;
	config: CronJobConfig;
	cron: Cron;
	telegramChatId?: number;
}

export class CronScheduler {
	private jobs = new Map<string, ActiveJob>();
	private filesByName = new Map<string, string>();
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	private watcher: ReturnType<typeof watch> | undefined;
	private options: CronSchedulerOptions;

	constructor(options: CronSchedulerOptions) {
		this.options = options;
	}

	get jobCount(): number {
		return this.jobs.size;
	}

	start() {
		this.syncJobsWithDirectory();
		this.startWatcher();
		this.startPolling();
	}

	stop() {
		this.watcher?.close();
		this.watcher = undefined;
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}
		for (const [, job] of this.jobs) {
			job.cron.stop();
		}
		this.jobs.clear();
		this.filesByName.clear();
	}

	async triggerJob(name: string) {
		const filename = this.filesByName.get(name);
		if (!filename) return;
		const job = this.jobs.get(filename);
		if (!job) return;
		await this.executeJob(job);
	}

	startJob(name: string): CronRunStartResult {
		this.syncJobsWithDirectory();

		const filename = this.filesByName.get(name);
		const job = filename ? this.jobs.get(filename) : undefined;
		if (job) {
			void this.executeJob(job);
			return {
				status: "accepted",
				jobName: job.config.name,
			};
		}

		const disabled = this.findDisabledJob(name);
		if (disabled) {
			return {
				status: "disabled",
				jobName: disabled.name,
			};
		}

		return {
			status: "not_found",
			jobName: name,
		};
	}

	private syncJobsWithDirectory() {
		const files = this.readJobFiles();
		if (!files) {
			for (const filename of this.jobs.keys()) {
				this.removeJobByFile(filename);
			}
			return;
		}

		const filenames = new Set(files);
		for (const filename of this.jobs.keys()) {
			if (!filenames.has(filename)) {
				this.removeJobByFile(filename);
			}
		}

		for (const file of files) {
			this.loadJobFile(file);
		}
	}

	private readJobFiles(): string[] | undefined {
		if (!existsSync(this.options.cronDir)) return undefined;

		return readdirSync(this.options.cronDir).filter((filename) =>
			isCronJobFile(filename),
		);
	}

	private loadJobFile(filename: string) {
		try {
			const content = readFileSync(
				join(this.options.cronDir, filename),
				"utf-8",
			);
			const config = parseJobConfig(content);

			if (!config.enabled) {
				this.removeJobByFile(filename);
				return;
			}

			this.registerJob(filename, config);
		} catch (err) {
			console.warn(`Skipping cron job ${filename}: ${extractError(err)}`);
		}
	}

	private registerJob(filename: string, config: CronJobConfig) {
		this.removeJobByFile(filename);

		const duplicateFile = this.filesByName.get(config.name);
		if (duplicateFile && duplicateFile !== filename) {
			this.removeJobByFile(duplicateFile);
		}

		const telegramChatId = this.options.resolveTelegramChatId?.(config);
		const offsetHours =
			config.timezone === undefined
				? null
				: parseUtcOffsetHours(config.timezone);
		const cron = new Cron(
			config.schedule,
			offsetHours === null ? {} : { utcOffset: offsetHours * 60 },
			() => {
				const job = this.jobs.get(filename);
				if (!job) {
					return;
				}
				void this.executeJob(job);
			},
		);

		this.jobs.set(filename, { filename, config, cron, telegramChatId });
		this.filesByName.set(config.name, filename);
	}

	private async executeJob(job: ActiveJob) {
		const model = job.config.model ?? this.options.getDefaultModel();
		const effort = normalizeCronEffort(
			model,
			job.config.effort ?? this.options.getDefaultEffort(),
		);

		try {
			const runResult = normalizeRunResult(
				await this.options.runAgent(job.config.prompt, model, effort),
			);

			if (isSuppressedCronResult(runResult.text)) {
				await this.options.onResult({
					jobName: job.config.name,
					model,
					sessionId: runResult.sessionId,
					suppressDelivery: true,
					telegramChatId: job.telegramChatId,
					text: "",
				});
				return;
			}

			await this.options.onResult({
				jobName: job.config.name,
				model,
				sessionId: runResult.sessionId,
				telegramChatId: job.telegramChatId,
				text: runResult.text,
			});
		} catch (err) {
			await this.options.onResult({
				jobName: job.config.name,
				model,
				telegramChatId: job.telegramChatId,
				text: `[error] ${extractError(err)}`,
			});
		}
	}

	private startWatcher() {
		if (!existsSync(this.options.cronDir) || this.watcher) return;

		const watcherFactory = this.options.watchDir ?? watch;
		this.watcher = watcherFactory(this.options.cronDir, (_event, filename) => {
			if (!filename) {
				this.syncJobsWithDirectory();
				return;
			}
			const normalizedFilename =
				typeof filename === "string" ? filename : filename.toString("utf-8");
			if (!hasCronJobExtension(normalizedFilename)) {
				return;
			}

			this.syncJobsWithDirectory();
		});
		this.watcher.on("error", (err) => {
			this.handleWatcherError(err);
		});
	}

	private startPolling() {
		if (this.pollTimer) return;

		const intervalMs = this.options.watchPollIntervalMs ?? 1000;
		this.pollTimer = setInterval(() => {
			this.syncJobsWithDirectory();
		}, intervalMs);
		this.pollTimer.unref?.();
	}

	private removeJobByFile(filename: string) {
		const job = this.jobs.get(filename);
		if (!job) {
			return;
		}

		job.cron.stop();
		this.jobs.delete(filename);
		if (this.filesByName.get(job.config.name) === filename) {
			this.filesByName.delete(job.config.name);
		}
	}

	private handleWatcherError(err: unknown) {
		console.warn(`Cron watcher error: ${extractError(err)}`);
		this.watcher?.close();
		this.watcher = undefined;
		this.syncJobsWithDirectory();
		this.startWatcher();
	}

	private findDisabledJob(name: string): CronJobConfig | undefined {
		const files = this.readJobFiles();
		if (!files) {
			return undefined;
		}

		for (const filename of files) {
			try {
				const config = parseJobConfig(
					readFileSync(join(this.options.cronDir, filename), "utf-8"),
				);
				if (config.name === name && !config.enabled) {
					return config;
				}
			} catch {}
		}

		return undefined;
	}
}

function normalizeRunResult(
	result: string | CronAgentRunResult,
): CronAgentRunResult {
	if (typeof result === "string") {
		return {
			text: result,
		};
	}

	return result;
}

function isSuppressedCronResult(text: string): boolean {
	return text.trim().replace(/`/g, "").toUpperCase() === "NO_REPLY";
}

function normalizeCronEffort(model: string, effort: EffortLevel): EffortLevel {
	if (isOpusOnlyEffort(effort) && !isCronOpusModel(model)) {
		return "high";
	}

	return effort;
}

function isCronOpusModel(model: string): boolean {
	return resolveModelAlias(model) === MODELS.opus.id;
}
