import type {
	DoneEvent,
	FacadeEvent,
	HeartbeatResult,
	ImageRef,
	ReplyContext,
	TranscriptTurn,
} from "../../common/protocol.ts";
import { extractError } from "../../common/protocol.ts";
import type { PromptRunner } from "./prompt-runner.ts";
import type { RuntimeClientGateway } from "./runtime-client-gateway.ts";
import type { RuntimeState } from "./runtime-state.ts";
import type { SessionService } from "./session-service.ts";

export type PromptSource = "heartbeat" | "telegram" | "tui" | "agent";
export interface AgentPromptMetadata {
	fromAgentId: string;
	fromAgentName: string;
}

export interface PromptExecution {
	agentMessage?: AgentPromptMetadata;
	images?: ImageRef[];
	onEvent?: (event: FacadeEvent) => void;
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
	readTranscript?: (sessionId: string) => Promise<TranscriptTurn[]>;
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
				? this.options.clients.listInteractiveTargets(task.sender)
				: [];
		const heartbeatBuffer: FacadeEvent[] = [];
		let completedEvent: DoneEvent | undefined;

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
			task.onEvent?.(event);
			if (task.source === "heartbeat") {
				heartbeatBuffer.push(event);
			}
			if (task.sender) {
				this.options.clients.send(task.sender, event);
			}
			this.options.clients.sendMany(observers, event);
			if (event.type === "error") {
				completedEvent = undefined;
			}
			if (
				event.type === "done" &&
				this.options.state.generation === generation
			) {
				completedEvent = event;
				this.options.sessions.completeRun(
					event,
					task.source,
					task.telegramChatId,
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

		if (completedEvent) {
			try {
				await this.options.sessions.refreshTranscript(
					completedEvent.sessionId,
					this.options.readTranscript,
				);
			} catch (err) {
				console.error(
					`Failed to refresh transcript search snapshot: ${extractError(err)}`,
				);
			}
		}

		const heartbeatDeliveryTarget =
			task.source === "heartbeat"
				? this.options.state.createHeartbeatDeliveryTarget()
				: undefined;
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
