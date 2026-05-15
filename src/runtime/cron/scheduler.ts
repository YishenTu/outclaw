import {
	existsSync,
	readdirSync,
	readFileSync,
	watch,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Cron } from "croner";
import type { EffortLevel } from "../../common/commands.ts";
import {
	hasCronJobExtension,
	isCronJobFile,
} from "../../common/cron-job-file.ts";
import { extractError } from "../../common/protocol.ts";
import {
	CronExecutionPolicy,
	type CronExecutionResult,
	type CronRunStartResult,
} from "./execution-policy.ts";
import {
	type CronJobConfig,
	parseJobConfig,
	parseUtcOffsetHours,
	serializeJobConfig,
} from "./job-config.ts";
import {
	type CronSchedule,
	isRunAtExpired,
	resolveJobSchedule,
} from "./schedule.ts";

export type { CronRunStartResult } from "./execution-policy.ts";

interface CronSchedulerOptions {
	cronDir: string;
	runAgent: (
		prompt: string,
		model?: string,
		effort?: EffortLevel,
	) => Promise<string | { sessionId?: string; text: string }>;
	onResult: (result: CronExecutionResult) => Promise<void> | void;
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
	content: string;
	config: CronJobConfig;
	schedule: CronSchedule;
	cron: Cron;
	telegramChatId?: number;
}

export class CronScheduler {
	private jobs = new Map<string, ActiveJob>();
	private filesByName = new Map<string, string>();
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	private watcher: ReturnType<typeof watch> | undefined;
	private options: CronSchedulerOptions;
	private executionPolicy: CronExecutionPolicy;

	constructor(options: CronSchedulerOptions) {
		this.options = options;
		this.executionPolicy = new CronExecutionPolicy({
			getDefaultEffort: options.getDefaultEffort,
			onResult: options.onResult,
			runAgent: options.runAgent,
		});
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
		await this.executionPolicy.runScheduledJob(job);
	}

	startJob(name: string): CronRunStartResult {
		this.syncJobsWithDirectory();

		const filename = this.filesByName.get(name);
		const job = filename ? this.jobs.get(filename) : undefined;
		return this.executionPolicy.startManualRun(
			name,
			job,
			this.findDisabledJob(name),
		);
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
			if (this.jobs.get(filename)?.content === content) {
				return;
			}

			const config = parseJobConfig(content);

			if (!config.enabled) {
				this.removeJobByFile(filename);
				return;
			}

			const schedule = resolveJobSchedule(config);
			if (schedule.kind === "once" && isRunAtExpired(schedule.runAt)) {
				this.removeJobByFile(filename);
				return;
			}

			this.registerJob(filename, content, config, schedule);
		} catch (err) {
			console.warn(`Skipping cron job ${filename}: ${extractError(err)}`);
		}
	}

	private registerJob(
		filename: string,
		content: string,
		config: CronJobConfig,
		schedule: CronSchedule,
	) {
		this.removeJobByFile(filename);

		const duplicateFile = this.filesByName.get(config.name);
		if (duplicateFile && duplicateFile !== filename) {
			this.removeJobByFile(duplicateFile);
		}

		const telegramChatId = this.options.resolveTelegramChatId?.(config);
		const offsetHours =
			schedule.kind !== "recurring" || schedule.timezone === undefined
				? null
				: parseUtcOffsetHours(schedule.timezone);
		const cron = new Cron(
			schedule.kind === "once" ? schedule.runAt : schedule.expression,
			offsetHours === null ? {} : { utcOffset: offsetHours * 60 },
			() => {
				const job = this.jobs.get(filename);
				if (!job) {
					return;
				}
				this.handleScheduledJob(job);
			},
		);

		this.jobs.set(filename, {
			filename,
			content,
			config,
			schedule,
			cron,
			telegramChatId,
		});
		this.filesByName.set(config.name, filename);
	}

	private handleScheduledJob(job: ActiveJob) {
		if (job.schedule.kind === "once") {
			this.disableOneTimeJob(job);
		}

		void this.executionPolicy.runScheduledJob(job);
	}

	private disableOneTimeJob(job: ActiveJob) {
		try {
			writeFileSync(
				join(this.options.cronDir, job.filename),
				serializeJobConfig({
					...job.config,
					enabled: false,
				}),
			);
		} catch (err) {
			console.warn(
				`Failed to disable one-time cron job ${job.filename}: ${extractError(err)}`,
			);
		}

		this.removeJobByFile(job.filename);
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
