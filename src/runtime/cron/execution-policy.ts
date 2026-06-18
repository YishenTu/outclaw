import { randomUUID } from "node:crypto";
import type { EffortLevel } from "../../common/commands.ts";
import { extractError } from "../../common/protocol.ts";
import type { CronJobConfig } from "./job-config.ts";

export interface CronAgentRunResult {
	providerId?: string;
	sessionId?: string;
	text: string;
}

export interface CronExecutionResult {
	jobName: string;
	model: string;
	failureMessage?: string;
	persistResultText?: boolean;
	providerId?: string;
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

export interface CronExecutableJob {
	config: Pick<CronJobConfig, "effort" | "model" | "name" | "prompt">;
	telegramChatId?: number;
}

interface DisabledCronJob {
	name: string;
}

interface CronExecutionPolicyOptions {
	getDefaultEffort: () => EffortLevel;
	onResult: (result: CronExecutionResult) => Promise<void> | void;
	runAgent: (
		prompt: string,
		model?: string,
		effort?: EffortLevel,
	) => Promise<string | CronAgentRunResult>;
}

export class CronExecutionPolicy {
	constructor(private readonly options: CronExecutionPolicyOptions) {}

	startManualRun(
		name: string,
		job: CronExecutableJob | undefined,
		disabledJob?: DisabledCronJob,
	): CronRunStartResult {
		if (job) {
			void this.runScheduledJob(job);
			return {
				status: "accepted",
				jobName: job.config.name,
			};
		}

		if (disabledJob) {
			return {
				status: "disabled",
				jobName: disabledJob.name,
			};
		}

		return {
			status: "not_found",
			jobName: name,
		};
	}

	async runScheduledJob(job: CronExecutableJob): Promise<void> {
		const model = job.config.model;
		const effort = job.config.effort ?? this.options.getDefaultEffort();

		try {
			const runResult = normalizeRunResult(
				await this.options.runAgent(job.config.prompt, model, effort),
			);
			if (runResult.text.trim() === "") {
				throw Object.assign(new Error("Cron run produced no assistant text"), {
					...(runResult.providerId ? { providerId: runResult.providerId } : {}),
					...(runResult.sessionId ? { sessionId: runResult.sessionId } : {}),
				});
			}

			if (isSuppressedCronResult(runResult.text)) {
				await this.options.onResult({
					jobName: job.config.name,
					model,
					...(runResult.providerId ? { providerId: runResult.providerId } : {}),
					sessionId: runResult.sessionId,
					suppressDelivery: true,
					telegramChatId: job.telegramChatId,
					text: runResult.text,
				});
				return;
			}

			await this.options.onResult({
				jobName: job.config.name,
				model,
				...(runResult.providerId ? { providerId: runResult.providerId } : {}),
				sessionId: runResult.sessionId,
				telegramChatId: job.telegramChatId,
				text: runResult.text,
			});
		} catch (err) {
			const failureMessage = extractError(err);
			await this.options.onResult({
				failureMessage,
				jobName: job.config.name,
				model,
				persistResultText: true,
				...(extractErrorProviderId(err)
					? { providerId: extractErrorProviderId(err) }
					: {}),
				sessionId: extractErrorSessionId(err) ?? randomUUID(),
				telegramChatId: job.telegramChatId,
				text: `[error] ${failureMessage}`,
			});
		}
	}
}

function extractErrorProviderId(err: unknown): string | undefined {
	if (!err || typeof err !== "object" || !("providerId" in err)) {
		return undefined;
	}

	const providerId = (err as { providerId?: unknown }).providerId;
	return typeof providerId === "string" && providerId !== ""
		? providerId
		: undefined;
}

function extractErrorSessionId(err: unknown): string | undefined {
	if (!err || typeof err !== "object" || !("sessionId" in err)) {
		return undefined;
	}

	const sessionId = (err as { sessionId?: unknown }).sessionId;
	return typeof sessionId === "string" && sessionId !== ""
		? sessionId
		: undefined;
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
