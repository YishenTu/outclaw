import type {
	BrowserSidebarInvalidatedEvent,
	CronResultEvent,
} from "../../common/protocol.ts";
import { extractError } from "../../common/protocol.ts";
import type { RuntimeClientGateway } from "./gateway/runtime-client-gateway.ts";
import type { SessionService } from "./session-service.ts";

interface CronExecutionResult {
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

interface RuntimeCronBroadcasterOptions {
	agentId?: string;
	clients: RuntimeClientGateway;
	deliverCronResult?: (params: {
		jobName: string;
		telegramChatId: number;
		text: string;
	}) => Promise<void> | void;
	refreshTranscript?: (
		providerId: string,
		sessionId: string,
	) => Promise<void> | void;
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
		const ranAt = Date.now();
		const providerId = result.providerId ?? this.options.sessions.providerId;
		if (result.sessionId) {
			this.options.sessions.recordCronRun({
				providerId,
				sessionId: result.sessionId,
				jobName: result.jobName,
				model: result.model,
				ranAt,
				...(result.persistResultText ? { resultText: result.text } : {}),
				...(result.failureMessage
					? {
							failure: {
								failedAt: ranAt,
								message: result.failureMessage,
							},
						}
					: {}),
			});
			if (!result.persistResultText && this.options.refreshTranscript) {
				try {
					await this.options.refreshTranscript(providerId, result.sessionId);
				} catch (err) {
					console.error(
						`Failed to refresh cron transcript snapshot: ${extractError(err)}`,
					);
				}
			}
			this.notifyBrowserCronChanged();
		}

		if (result.suppressDelivery) {
			return;
		}

		const event: CronResultEvent = {
			type: "cron_result",
			jobName: result.jobName,
			providerId,
			text: result.text,
			sessionId: result.sessionId,
			ranAt,
		};
		this.options.clients.broadcast(event);

		const telegramChatId = result.telegramChatId;
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

	private notifyBrowserCronChanged() {
		if (!this.options.agentId) {
			return;
		}

		const event: BrowserSidebarInvalidatedEvent = {
			type: "browser_sidebar_invalidated",
			agentId: this.options.agentId,
			sections: ["cron"],
		};
		this.options.clients.sendMany(
			this.options.clients.listBrowserTargets(),
			event,
		);
	}
}
