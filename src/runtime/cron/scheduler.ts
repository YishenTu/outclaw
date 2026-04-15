import { existsSync, readdirSync, readFileSync, watch } from "node:fs";
import { join } from "node:path";
import { Cron } from "croner";
import { extractError } from "../../common/protocol.ts";
import { type CronJobConfig, parseJobConfig } from "./job-config.ts";

interface CronAgentRunResult {
	sessionId?: string;
	text: string;
}

interface CronExecutionResult {
	jobName: string;
	model: string;
	sessionId?: string;
	telegramChatId?: number;
	text: string;
}

interface CronSchedulerOptions {
	cronDir: string;
	runAgent: (
		prompt: string,
		model?: string,
	) => Promise<string | CronAgentRunResult>;
	onResult: (result: CronExecutionResult) => Promise<void> | void;
	getDefaultModel: () => string;
	resolveTelegramChatId?: (config: CronJobConfig) => number | undefined;
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
	}

	stop() {
		this.watcher?.close();
		this.watcher = undefined;
		for (const [, job] of this.jobs) {
			job.cron.stop();
		}
		this.jobs.clear();
	}

	async triggerJob(name: string) {
		const filename = this.filesByName.get(name);
		if (!filename) return;
		const job = this.jobs.get(filename);
		if (!job) return;
		await this.executeJob(job);
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

		return readdirSync(this.options.cronDir).filter(
			(f) => f.endsWith(".yaml") || f.endsWith(".yml"),
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
		const cron = new Cron(config.schedule, () => {
			const job = this.jobs.get(filename);
			if (!job) {
				return;
			}
			void this.executeJob(job);
		});

		this.jobs.set(filename, { filename, config, cron, telegramChatId });
		this.filesByName.set(config.name, filename);
	}

	private async executeJob(job: ActiveJob) {
		const model = job.config.model ?? this.options.getDefaultModel();

		try {
			const runResult = normalizeRunResult(
				await this.options.runAgent(job.config.prompt, model),
			);

			if (isSuppressedCronResult(runResult.text)) return;

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
			if (!filename) return;
			const normalizedFilename =
				typeof filename === "string" ? filename : filename.toString("utf-8");
			if (
				!normalizedFilename.endsWith(".yaml") &&
				!normalizedFilename.endsWith(".yml")
			) {
				return;
			}

			this.reloadJobFile(normalizedFilename);
		});
		this.watcher.on("error", (err) => {
			this.handleWatcherError(err);
		});
	}

	private reloadJobFile(filename: string) {
		const filepath = join(this.options.cronDir, filename);

		if (!existsSync(filepath)) {
			this.removeJobByFile(filename);
			return;
		}

		try {
			const content = readFileSync(filepath, "utf-8");
			const config = parseJobConfig(content);

			if (!config.enabled) {
				this.removeJobByFile(filename);
				return;
			}

			this.registerJob(filename, config);
		} catch (err) {
			this.removeJobByFile(filename);
			console.warn(
				`Failed to reload cron job ${filename}: ${extractError(err)}`,
			);
		}
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
