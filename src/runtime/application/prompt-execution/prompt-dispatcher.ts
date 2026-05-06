import type {
	DisplayImage,
	DoneEvent,
	FacadeEvent,
	HeartbeatResult,
	ImageRef,
	ReplyContext,
	SessionInitializedEvent,
	TranscriptTurn,
} from "../../../common/protocol.ts";
import { extractError } from "../../../common/protocol.ts";
import type { RuntimeClientGateway } from "../gateway/runtime-client-gateway.ts";
import type { SessionService } from "../session-service.ts";
import type {
	RuntimePromptContext,
	RuntimeState,
} from "../state/runtime-state.ts";
import type { PromptRunner } from "./prompt-runner.ts";
import type { StreamingStateStore } from "./streaming-state-store.ts";

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
	sender?: import("../../transport/client-hub.ts").WsClient;
	source: PromptSource;
	stream?: boolean;
	telegramBotId?: string;
	telegramChatId?: number;
}

type ClientFacadeEvent = Exclude<FacadeEvent, SessionInitializedEvent>;

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
	streamingState: StreamingStateStore;
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
		if (observedSessionId) {
			this.options.streamingState.start(observedSessionId);
		}

		if (
			isVisible() &&
			(task.source === "telegram" ||
				task.source === "heartbeat" ||
				task.source === "rollover" ||
				task.source === "tui" ||
				task.source === "browser")
		) {
			this.options.clients.sendMany(this.listPromptStartObservers(task), {
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
			const visible = isVisible();
			if (event.type === "session_initialized") {
				if (!context.resumeSessionId) {
					this.options.sessions.recordSessionInitialized({
						active: visible,
						sessionId: event.sessionId,
						ocSessionId: context.ocSessionId,
						title: context.sessionTitle ?? "Untitled",
						model: context.model,
						source: toStoredSessionSource(task.source),
					});
				}
				task.onEvent?.(event);
				return;
			}

			const observedEvent = attachObservedSessionId(event, observedSessionId);
			if (
				event.type === "error" &&
				abortController.signal.aborted &&
				visible &&
				task.source !== "agent"
			) {
				completedEvent = undefined;
				return;
			}

			task.onEvent?.(event);
			if (observedSessionId) {
				this.options.streamingState.recordEvent(observedSessionId, event);
			}
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
						ocSessionId: context.ocSessionId,
						source: toStoredSessionSource(task.source),
						title: context.sessionTitle ?? "Untitled",
					});
				}
			}
		};

		try {
			await this.options.promptRunner.run({
				abortController,
				effort: context.effort,
				emit,
				model: context.resolvedModel,
				ocSessionId: context.ocSessionId,
				resume: context.resumeSessionId,
				task,
			});
		} finally {
			if (observedSessionId) {
				this.options.streamingState.clear(observedSessionId);
			}
		}

		if (
			abortController.signal.aborted &&
			!completedEvent &&
			!context.resumeSessionId &&
			isVisible() &&
			shouldPersistInterruptedRun(task.source)
		) {
			this.options.sessions.recordInterruptedRun({
				sessionId: context.ocSessionId,
				title: context.sessionTitle ?? "Untitled",
				model: context.model,
				source: toStoredSessionSource(task.source),
			});
		}

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

	private listPromptStartObservers(task: PromptExecution) {
		const observers = this.listObservers(task);
		if ((task.source === "browser" || task.source === "tui") && task.sender) {
			return [task.sender, ...observers];
		}
		return observers;
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

function shouldPersistInterruptedRun(source: PromptSource): boolean {
	return source === "browser" || source === "telegram" || source === "tui";
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
	event: ClientFacadeEvent,
	observedSessionId: string | undefined,
): ClientFacadeEvent {
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
