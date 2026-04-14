import type {
	FacadeEvent,
	HeartbeatResult,
	ImageRef,
	ReplyContext,
} from "../../common/protocol.ts";
import { extractError } from "../../common/protocol.ts";
import type { PromptRunner } from "./prompt-runner.ts";
import type { RuntimeClientGateway } from "./runtime-client-gateway.ts";
import type { RuntimeState } from "./runtime-state.ts";
import type { SessionService } from "./session-service.ts";

export type PromptSource = "heartbeat" | "telegram" | "tui";

export interface PromptExecution {
	images?: ImageRef[];
	prompt: string;
	replyContext?: ReplyContext;
	sender?: import("../transport/client-hub.ts").WsClient;
	source: PromptSource;
	stream?: boolean;
	telegramBotId?: string;
	telegramChatId?: number;
}

interface PromptDispatcherOptions {
	clients: RuntimeClientGateway;
	deliverHeartbeatResult?: (
		params: {
			telegramChatId: number;
		} & HeartbeatResult,
	) => Promise<void> | void;
	promptRunner: PromptRunner;
	sessions: SessionService;
	state: RuntimeState;
}

export class PromptDispatcher {
	private readonly options: PromptDispatcherOptions;
	private deliverHeartbeatResult:
		| PromptDispatcherOptions["deliverHeartbeatResult"]
		| undefined;

	constructor(options: PromptDispatcherOptions) {
		this.options = options;
		this.deliverHeartbeatResult = options.deliverHeartbeatResult;
	}

	setHeartbeatResultHandler(
		handler: PromptDispatcherOptions["deliverHeartbeatResult"],
	) {
		this.deliverHeartbeatResult = handler;
	}

	async run(
		task: PromptExecution,
		generation: number,
		abortController: AbortController,
	) {
		const observers =
			task.source === "telegram" || task.source === "heartbeat"
				? this.options.clients.listTuiTargets(task.sender)
				: [];
		const heartbeatDeliveryTarget =
			task.source === "heartbeat"
				? this.options.state.createHeartbeatDeliveryTarget()
				: undefined;
		const heartbeatBuffer: FacadeEvent[] = [];

		if (task.source === "telegram" || task.source === "heartbeat") {
			this.options.clients.sendMany(observers, {
				type: "user_prompt",
				prompt: task.prompt,
				images: task.images,
				replyContext: task.replyContext,
				source: task.source,
			});
		}

		const emit = (event: FacadeEvent) => {
			if (task.source === "heartbeat") {
				heartbeatBuffer.push(event);
			}
			if (task.sender) {
				this.options.clients.send(task.sender, event);
			}
			this.options.clients.sendMany(observers, event);
			if (
				event.type === "done" &&
				this.options.state.generation === generation
			) {
				this.options.sessions.completeRun(
					event,
					task.source,
					task.telegramChatId,
					task.telegramBotId,
				);
				this.options.clients.broadcastStatus();
			}
		};

		await this.options.promptRunner.run({
			abortController,
			effort: this.options.state.effort,
			emit,
			model: this.options.state.resolvedModel,
			resume: this.options.state.sessionId,
			task,
		});

		if (
			task.source === "heartbeat" &&
			heartbeatDeliveryTarget?.clientType === "telegram" &&
			heartbeatDeliveryTarget.telegramChatId !== undefined &&
			this.deliverHeartbeatResult
		) {
			try {
				await this.deliverHeartbeatResult({
					telegramChatId: heartbeatDeliveryTarget.telegramChatId,
					...toHeartbeatResult(heartbeatBuffer),
				});
			} catch (err) {
				console.error(
					`Failed to deliver heartbeat result to Telegram: ${extractError(err)}`,
				);
			}
		}
	}
}

function toHeartbeatResult(events: FacadeEvent[]): HeartbeatResult {
	let text = "";
	const images: HeartbeatResult["images"] = [];

	for (const event of events) {
		if (event.type === "text") {
			text += event.text;
			continue;
		}

		if (event.type === "image") {
			images.push({
				path: event.path,
				caption: event.caption,
			});
			continue;
		}

		if (event.type === "error") {
			text = text
				? `${text}\n[error] ${event.message}`
				: `[error] ${event.message}`;
		}
	}

	return {
		images,
		text,
	};
}
