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
}

interface ActiveJob {
	filename: string;
	config: CronJobConfig;
	cron: Cron;
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
		this.loadAllJobs();
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
		await this.executeJob(job.config);
	}

	private loadAllJobs() {
		if (!existsSync(this.options.cronDir)) return;

		const files = readdirSync(this.options.cronDir).filter(
			(f) => f.endsWith(".yaml") || f.endsWith(".yml"),
		);

		for (const file of files) {
			this.loadJobFile(file);
		}
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

		const cron = new Cron(config.schedule, () => {
			void this.executeJob(config);
		});

		this.jobs.set(filename, { filename, config, cron });
		this.filesByName.set(config.name, filename);
	}

	private async executeJob(config: CronJobConfig) {
		const model = config.model ?? this.options.getDefaultModel();

		try {
			const runResult = normalizeRunResult(
				await this.options.runAgent(config.prompt, model),
			);

			if (isSuppressedCronResult(runResult.text)) return;

			await this.options.onResult({
				jobName: config.name,
				model,
				sessionId: runResult.sessionId,
				text: runResult.text,
			});
		} catch (err) {
			await this.options.onResult({
				jobName: config.name,
				model,
				text: `[error] ${extractError(err)}`,
			});
		}
	}

	private startWatcher() {
		if (!existsSync(this.options.cronDir)) return;

		this.watcher = watch(this.options.cronDir, (_event, filename) => {
			if (!filename) return;
			if (!filename.endsWith(".yaml") && !filename.endsWith(".yml")) return;

			this.reloadJobFile(filename);
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
