import type { EffortLevel } from "../../../common/commands.ts";
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
import type { SessionTag } from "../../persistence/session-store/session-store.ts";
import type { RuntimeClientGateway } from "../gateway/runtime-client-gateway.ts";
import type { SessionService } from "../session-service.ts";
import type {
	RuntimePromptContext,
	RuntimeState,
} from "../state/runtime-state.ts";
import { resolveSessionTitleForPersistence } from "../state/runtime-state.ts";
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
	includeRuntimeSystemPrompt?: boolean;
	cwd?: string;
	onEvent?: (event: FacadeEvent) => void;
	prompt: string;
	replyContext?: ReplyContext;
	resumeSessionId?: string;
	sender?: import("../../transport/client-hub.ts").WsClient;
	source: PromptSource;
	sessionTag?: SessionTag;
	storedSessionSource?: string;
	stream?: boolean;
	telegramBotId?: string;
	telegramChatId?: number;
	/**
	 * Per-call model override. When set, supersedes the runtime state's model
	 * for both the provider call and the persisted session record. Used by the
	 * coding runtime to send a Codex-side model id without mutating the shared
	 * chat-side runtime state.
	 */
	modelOverride?: string;
	/**
	 * Use the provider's configured default model for this run. Coding mode uses
	 * this when no explicit code-mode model was selected so chat aliases never
	 * leak into provider-owned coding defaults.
	 */
	useProviderDefaultModel?: boolean;
	/**
	 * Per-call reasoning effort override. Same rationale as `modelOverride`.
	 */
	effortOverride?: EffortLevel;
	/**
	 * Use the provider's configured default reasoning effort for this run.
	 */
	useProviderDefaultEffort?: boolean;
	/**
	 * Per-call provider service tier override. Codex uses this to switch
	 * between standard and priority/Fast tier for a single conversation.
	 */
	serviceTierOverride?: string;
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

		const storedModel =
			task.modelOverride ?? (task.useProviderDefaultModel ? "" : context.model);
		const runModel =
			task.modelOverride ??
			(task.useProviderDefaultModel ? undefined : context.resolvedModel);
		const runEffort =
			task.effortOverride ??
			(task.useProviderDefaultEffort ? undefined : context.effort);

		const emit = (event: FacadeEvent) => {
			const visible = isVisible();
			if (event.type === "session_initialized") {
				if (!context.resumeSessionId) {
					this.options.sessions.recordSessionInitialized({
						active: visible,
						sessionId: event.sessionId,
						ocSessionId: context.ocSessionId,
						title: titleForPersistence(context),
						model: storedModel,
						source: toStoredSessionSource(task),
						tag: task.sessionTag,
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
						model: storedModel,
						ocSessionId: context.ocSessionId,
						source: toStoredSessionSource(task),
						tag: task.sessionTag,
						title: titleForPersistence(context),
					});
				}
			}
		};

		try {
			await this.options.promptRunner.run({
				abortController,
				effort: runEffort,
				emit,
				model: runModel,
				ocSessionId: context.ocSessionId,
				resume: context.resumeSessionId,
				serviceTier: task.serviceTierOverride,
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
				title: titleForPersistence(context),
				model: storedModel,
				source: toInterruptedSessionSource(task.source),
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

function titleForPersistence(context: RuntimePromptContext): string {
	return resolveSessionTitleForPersistence(context);
}

function toStoredSessionSource(task: PromptExecution): string {
	if (task.storedSessionSource) {
		return task.storedSessionSource;
	}
	if (task.source === "telegram") {
		return "telegram";
	}
	if (task.source === "agent") {
		return "agent";
	}
	return "tui";
}

function shouldPersistInterruptedRun(
	source: PromptSource,
): source is "browser" | "telegram" | "tui" {
	return source === "browser" || source === "telegram" || source === "tui";
}

function toInterruptedSessionSource(
	source: "browser" | "telegram" | "tui",
): "telegram" | "tui" {
	return source === "telegram" ? "telegram" : "tui";
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
