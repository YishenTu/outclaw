import type { CronResultEvent } from "../../common/protocol.ts";
import { extractError } from "../../common/protocol.ts";
import type { RuntimeClientGateway } from "./runtime-client-gateway.ts";
import type { SessionService } from "./session-service.ts";

interface CronExecutionResult {
	jobName: string;
	model: string;
	sessionId?: string;
	text: string;
}

interface RuntimeCronBroadcasterOptions {
	clients: RuntimeClientGateway;
	deliverCronResult?: (params: {
		jobName: string;
		telegramChatId: number;
		text: string;
	}) => Promise<void> | void;
	sessions: SessionService;
}

export class RuntimeCronBroadcaster {
	private deliverCronResult:
		| RuntimeCronBroadcasterOptions["deliverCronResult"]
		| undefined;

	constructor(private readonly options: RuntimeCronBroadcasterOptions) {
		this.deliverCronResult = options.deliverCronResult;
	}

	async broadcastResult(result: CronExecutionResult) {
		if (result.sessionId) {
			this.options.sessions.recordCronRun({
				sessionId: result.sessionId,
				jobName: result.jobName,
				model: result.model,
			});
		}

		const event: CronResultEvent = {
			type: "cron_result",
			jobName: result.jobName,
			text: result.text,
		};
		this.options.clients.broadcast(event);

		const telegramChatId = this.options.sessions.lastTelegramChatId;
		if (!this.deliverCronResult || telegramChatId === undefined) {
			return;
		}

		try {
			await this.deliverCronResult({
				jobName: result.jobName,
				telegramChatId,
				text: result.text,
			});
		} catch (err) {
			console.error(
				`Failed to deliver cron result to Telegram: ${extractError(err)}`,
			);
		}
	}

	setHandler(handler: RuntimeCronBroadcasterOptions["deliverCronResult"]) {
		this.deliverCronResult = handler;
	}
}
