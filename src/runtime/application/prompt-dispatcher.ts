import type {
	DisplayImage,
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
import type { RuntimePromptContext, RuntimeState } from "./runtime-state.ts";
import type { SessionService } from "./session-service.ts";

export type PromptSource =
	| "heartbeat"
	| "rollover"
	| "telegram"
	| "tui"
	| "browser"
	| "agent";
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
	onVisibleRunStarted?: () => void;
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
		context: RuntimePromptContext & {
			isVisible: () => boolean;
			resumeSessionId?: string;
		},
		abortController: AbortController,
	) {
		const heartbeatBuffer: FacadeEvent[] = [];
		let completedEvent: DoneEvent | undefined;
		const observedSessionId = context.resumeSessionId;
		const isVisible = () => context.isVisible();

		if (
			isVisible() &&
			(task.source === "telegram" ||
				task.source === "heartbeat" ||
				task.source === "rollover" ||
				task.source === "tui" ||
				task.source === "browser")
		) {
			this.options.clients.sendMany(this.listObservers(task), {
				type: "user_prompt",
				prompt: task.prompt,
				images: toDisplayImages(task.images),
				replyContext: task.replyContext,
				source: task.source,
				sessionId: observedSessionId,
			});
			this.options.onVisibleRunStarted?.();
		}

		const emit = (event: FacadeEvent) => {
			const observedEvent = attachObservedSessionId(event, observedSessionId);
			task.onEvent?.(event);
			const visible = isVisible();
			if (task.source === "heartbeat") {
				heartbeatBuffer.push(event);
			}
			if (visible && task.sender) {
				this.options.clients.send(task.sender, observedEvent);
			}
			if (visible) {
				this.options.clients.sendMany(this.listObservers(task), observedEvent);
			}
			if (event.type === "error") {
				completedEvent = undefined;
			}
			if (event.type === "done") {
				completedEvent = event;
				if (visible) {
					this.options.sessions.completeRun(
						event,
						task.source,
						task.telegramChatId,
					);
				} else {
					this.options.sessions.recordBackgroundCompletion({
						event,
						model: context.model,
						source: toStoredSessionSource(task.source),
						title: context.sessionTitle ?? "Untitled",
					});
				}
			}
		};

		await this.options.promptRunner.run({
			abortController,
			effort: context.effort,
			emit,
			model: context.resolvedModel,
			resume: context.resumeSessionId,
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

	private listObservers(task: PromptExecution) {
		if (
			task.source === "telegram" ||
			task.source === "heartbeat" ||
			task.source === "rollover" ||
			task.source === "browser"
		) {
			return this.options.clients.listInteractiveTargets(task.sender);
		}

		if (task.source === "tui") {
			return this.options.clients.listBrowserTargets(task.sender);
		}

		return [];
	}
}

function toStoredSessionSource(
	source: PromptSource,
): "agent" | "telegram" | "tui" {
	if (source === "telegram") {
		return "telegram";
	}
	if (source === "agent") {
		return "agent";
	}
	return "tui";
}

function toDisplayImages(
	images: ImageRef[] | undefined,
): DisplayImage[] | undefined {
	if (!images || images.length === 0) {
		return undefined;
	}

	return images.map((image) => ({
		kind: "managed",
		path: image.path,
		mediaType: image.mediaType,
	}));
}

function attachObservedSessionId(
	event: FacadeEvent,
	observedSessionId: string | undefined,
): FacadeEvent {
	if (
		observedSessionId === undefined ||
		event.type === "done" ||
		event.type === "status"
	) {
		return event;
	}

	return {
		...event,
		sessionId: observedSessionId,
	};
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
