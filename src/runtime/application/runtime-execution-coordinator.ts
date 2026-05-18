import { extractError } from "../../common/protocol.ts";
import {
	type HeartbeatAttemptResult,
	HeartbeatRuntimePolicy,
} from "../heartbeat/runtime-policy.ts";
import type { AutoTitleCoordinator } from "./auto-title.ts";
import { MessageQueue } from "./gateway/message-queue.ts";
import type {
	PromptDispatcher,
	PromptExecution,
} from "./prompt-execution/prompt-dispatcher.ts";
import type { SessionService } from "./session-service.ts";
import type {
	RuntimePromptContext,
	RuntimeState,
} from "./state/runtime-state.ts";

interface HeartbeatTask {
	prompt: string;
	scheduledAt: number;
	sessionId: string;
}

interface RuntimeExecutionCoordinatorOptions {
	autoTitle?: Pick<
		AutoTitleCoordinator,
		"cancel" | "cancelAll" | "drain" | "resolveSession" | "start"
	>;
	deliverRolloverNotice?: (params: {
		telegramChatId: number;
		text: string;
	}) => Promise<void> | void;
	onStatusChange?: () => void;
	promptDispatcher: Pick<PromptDispatcher, "run">;
	sessions: Pick<
		SessionService,
		| "beginRolloverAttempt"
		| "canPersistSessions"
		| "finishRolloverAttempt"
		| "recordAcceptedPromptTarget"
	>;
	state: RuntimeState;
}

interface ExecutionLane {
	activeAbort?: AbortController;
	activeContext?: RuntimePromptContext;
	detached?: boolean;
	key: string;
	queue: MessageQueue;
	resolvedProviderId?: string;
	resolvedSessionId?: string;
}

function laneKeyForSession(providerId: string, sdkSessionId: string): string {
	return `${providerId}:${sdkSessionId}`;
}

function laneKeyForPending(providerId: string, generation: number): string {
	return `pending:${providerId}:${generation}`;
}

function laneKeyForDetached(providerId: string, ocSessionId: string): string {
	return `detached:${providerId}:${ocSessionId}`;
}

export class RuntimeExecutionCoordinator {
	private heartbeatPolicy = new HeartbeatRuntimePolicy();
	private deliverRolloverNotice:
		| RuntimeExecutionCoordinatorOptions["deliverRolloverNotice"]
		| undefined;
	private lanes = new Map<string, ExecutionLane>();
	private rolloverQueued = false;
	private shuttingDown = false;

	constructor(private readonly options: RuntimeExecutionCoordinatorOptions) {
		this.deliverRolloverNotice = options.deliverRolloverNotice;
	}

	get isShuttingDown(): boolean {
		return this.shuttingDown;
	}

	get hasActiveRun(): boolean {
		return [...this.lanes.values()].some(
			(lane) => lane.activeAbort !== undefined,
		);
	}

	get hasVisibleRun(): boolean {
		return [...this.lanes.values()].some(
			(lane) =>
				lane.activeContext !== undefined &&
				this.isLaneVisible(lane, lane.activeContext),
		);
	}

	abortActiveRun(): boolean {
		const lane = [...this.lanes.values()].find(
			(candidate) =>
				candidate.activeAbort !== undefined &&
				candidate.activeContext !== undefined &&
				this.isLaneVisible(candidate, candidate.activeContext),
		);
		if (!lane?.activeAbort) {
			return false;
		}

		lane.activeAbort.abort();
		return true;
	}

	beginShutdown() {
		if (this.shuttingDown) {
			return;
		}
		this.shuttingDown = true;
		this.heartbeatPolicy.beginShutdown();
		this.options.autoTitle?.cancelAll();
		for (const lane of this.lanes.values()) {
			lane.activeAbort?.abort();
			lane.queue.close(true);
		}
	}

	async drain(): Promise<void> {
		await Promise.all([
			...[...this.lanes.values()].map((lane) => lane.queue.drain()),
			this.options.autoTitle?.drain() ?? Promise.resolve(),
		]);
	}

	enqueueHeartbeat(
		prompt: string,
		scheduledAt: number,
		deferMinutes: number,
	): boolean {
		if (this.shuttingDown) {
			return false;
		}
		if (this.shouldAttemptHeartbeat(scheduledAt, deferMinutes) !== "attempt") {
			return false;
		}

		const context = this.options.state.capturePromptContext();
		const sessionId = context.sessionId;
		if (!sessionId) {
			return false;
		}
		const lane = this.getOrCreateLane(context);

		this.heartbeatPolicy.markHeartbeatQueued();
		const queued = lane.queue.enqueue(() =>
			this.runHeartbeat(lane, context, {
				prompt,
				scheduledAt,
				sessionId,
			}),
		);
		if (!queued) {
			this.heartbeatPolicy.queueRejected();
		}
		return queued;
	}

	enqueuePrompt(task: PromptExecution) {
		if (this.shuttingDown) {
			return;
		}
		this.options.state.preparePrompt(task.prompt, task.images, {
			deferTitle: this.shouldDeferTitleForAutoTitle(task),
		});
		const context = this.options.state.capturePromptContext();
		const lane = this.getOrCreateLane(context);
		this.options.autoTitle?.start({
			context,
			prompt: task.prompt,
			source: task.source,
		});
		this.heartbeatPolicy.noteUserActivity();
		if (
			task.source === "telegram" ||
			task.source === "tui" ||
			task.source === "browser"
		) {
			this.options.sessions.recordAcceptedPromptTarget(
				task.source === "telegram" ? "telegram" : "tui",
				task.telegramChatId,
			);
		}
		lane.queue.enqueue(() => this.runPromptInLane(lane, task, context));
	}

	enqueueRollover(prompt: string, idleMinutes: number): boolean {
		if (this.shuttingDown || this.rolloverQueued || this.hasVisibleRun) {
			return false;
		}
		const context = this.options.state.capturePromptContext();
		if (context.sessionId === undefined) {
			return false;
		}
		const lane = this.getOrCreateLane(context);

		this.rolloverQueued = true;
		const queued = lane.queue.enqueue(() =>
			this.runRollover(lane, context, { idleMinutes, prompt }),
		);
		if (!queued) {
			this.rolloverQueued = false;
		}
		return queued;
	}

	enqueueAgentPrompt(task: PromptExecution): Promise<string> {
		return new Promise((resolve, reject) => {
			if (this.shuttingDown) {
				reject(new Error("Runtime shutting down"));
				return;
			}

			let responseText = "";
			let failed = false;
			const wrappedTask: PromptExecution = {
				...task,
				onEvent: (event) => {
					task.onEvent?.(event);
					if (event.type === "text") {
						responseText += event.text;
					}
					if (event.type === "error" && !failed) {
						failed = true;
						reject(new Error(event.message));
					}
				},
			};
			this.options.state.preparePrompt(wrappedTask.prompt, wrappedTask.images);
			const context = this.options.state.capturePromptContext();
			const lane = this.getOrCreateLane(context);
			const queued = lane.queue.enqueue(async () => {
				await this.runPromptInLane(lane, wrappedTask, context);
				if (!failed) {
					resolve(responseText);
				}
			});
			if (!queued) {
				reject(new Error("Runtime shutting down"));
			}
		});
	}

	enqueueAgentMessage(task: PromptExecution): boolean {
		if (this.shuttingDown) {
			return false;
		}

		this.options.state.preparePrompt(task.prompt, task.images);
		const context = this.options.state.capturePromptContext();
		const lane = this.getOrCreateLane(context);
		return lane.queue.enqueue(() => this.runPromptInLane(lane, task, context));
	}

	enqueueDetachedPrompt(
		task: PromptExecution,
	): { ocSessionId: string; abort: () => boolean } | undefined {
		if (this.shuttingDown) {
			return undefined;
		}

		const context = this.options.state.captureDetachedPromptContext(
			task.prompt,
			task.images,
			{ resumeSessionId: task.resumeSessionId },
		);
		const lane = this.createDetachedLane(
			context.providerId,
			context.ocSessionId,
		);
		const queued = lane.queue.enqueue(() =>
			this.runPromptInLane(lane, task, context),
		);
		return queued
			? {
					ocSessionId: context.ocSessionId,
					abort: () => this.abortLaneRun(lane),
				}
			: undefined;
	}

	setRolloverNoticeHandler(
		handler: RuntimeExecutionCoordinatorOptions["deliverRolloverNotice"],
	) {
		this.deliverRolloverNotice = handler;
	}

	setFireDeferredHeartbeat(handler: () => Promise<void> | void) {
		this.heartbeatPolicy.setFireDeferredHeartbeat(handler);
	}

	shouldAttemptHeartbeat(
		scheduledAt: number,
		deferMinutes: number,
	): HeartbeatAttemptResult {
		return this.heartbeatPolicy.shouldAttempt(
			this.options.state.sessionId !== undefined,
			scheduledAt,
			deferMinutes,
		);
	}

	startDeferTimer(deferMinutes: number) {
		this.heartbeatPolicy.startDeferTimer(deferMinutes);
	}

	private async runHeartbeat(
		lane: ExecutionLane,
		context: RuntimePromptContext,
		task: HeartbeatTask,
	) {
		try {
			if (this.options.state.sessionId !== task.sessionId) {
				return;
			}
			if (this.heartbeatPolicy.userActivityAt > task.scheduledAt) {
				return;
			}

			this.options.state.preparePrompt(task.prompt);
			await this.runPromptInLane(
				lane,
				{
					prompt: task.prompt,
					source: "heartbeat",
				},
				context,
			);
		} finally {
			this.heartbeatPolicy.completeHeartbeat();
		}
	}

	private async runRollover(
		lane: ExecutionLane,
		context: RuntimePromptContext,
		task: { idleMinutes: number; prompt: string },
	) {
		let failed = true;
		let started = false;

		try {
			if (this.options.state.sessionId === undefined) {
				return;
			}

			const deliveryTarget = this.options.state.createLastUserDeliveryTarget();
			const notice = this.options.sessions.beginRolloverAttempt(
				task.idleMinutes,
			);
			started = true;
			void this.deliverRolloverStartedNotice(deliveryTarget, notice.message);
			await this.runPromptInLane(
				lane,
				{
					onEvent: (event) => {
						if (event.type === "done") {
							failed = false;
						}
					},
					prompt: task.prompt,
					source: "rollover",
				},
				context,
			);
		} finally {
			this.rolloverQueued = false;
			if (started) {
				this.options.sessions.finishRolloverAttempt({
					failed,
					idleMinutes: task.idleMinutes,
				});
			}
			this.options.onStatusChange?.();
		}
	}

	private async deliverRolloverStartedNotice(
		target: ReturnType<RuntimeState["createLastUserDeliveryTarget"]>,
		text: string,
	) {
		if (
			target?.clientType !== "telegram" ||
			target.telegramChatId === undefined ||
			!this.deliverRolloverNotice
		) {
			return;
		}

		try {
			await this.deliverRolloverNotice({
				telegramChatId: target.telegramChatId,
				text,
			});
		} catch (err) {
			console.error(
				`Failed to deliver rollover notice to Telegram: ${extractError(err)}`,
			);
		}
	}

	private shouldDeferTitleForAutoTitle(task: PromptExecution): boolean {
		return (
			this.options.autoTitle !== undefined &&
			this.options.sessions.canPersistSessions &&
			this.options.state.sessionId === undefined &&
			(task.source === "browser" ||
				task.source === "telegram" ||
				task.source === "tui") &&
			task.prompt.trim() !== ""
		);
	}

	private getOrCreateLane(context: RuntimePromptContext): ExecutionLane {
		// Lane keys include providerId so a Codex session never shares a queue
		// with a Claude session that happens to have the same sdk session id,
		// and a pending Codex blank-session lane never collides with a pending
		// Claude blank-session lane in the same generation.
		const key = context.sessionId
			? laneKeyForSession(context.providerId, context.sessionId)
			: laneKeyForPending(context.providerId, context.generation);
		const existing =
			context.sessionId === undefined
				? this.lanes.get(key)
				: [...this.lanes.values()].find(
						(lane) =>
							(lane.resolvedProviderId === context.providerId &&
								lane.resolvedSessionId === context.sessionId) ||
							lane.key === key,
					);
		if (existing) {
			if (context.sessionId) {
				existing.resolvedProviderId = context.providerId;
				existing.resolvedSessionId = context.sessionId;
			}
			return existing;
		}

		const lane: ExecutionLane = {
			key,
			queue: new MessageQueue(),
			resolvedProviderId: context.sessionId ? context.providerId : undefined,
			resolvedSessionId: context.sessionId,
		};
		this.lanes.set(key, lane);
		return lane;
	}

	private createDetachedLane(
		providerId: string,
		ocSessionId: string,
	): ExecutionLane {
		const key = laneKeyForDetached(providerId, ocSessionId);
		const lane: ExecutionLane = {
			detached: true,
			key,
			queue: new MessageQueue(),
		};
		this.lanes.set(key, lane);
		return lane;
	}

	private abortLaneRun(lane: ExecutionLane): boolean {
		if (!lane.activeAbort || lane.activeAbort.signal.aborted) {
			return false;
		}
		lane.activeAbort.abort();
		return true;
	}

	private isLaneVisible(
		lane: ExecutionLane,
		context: RuntimePromptContext,
	): boolean {
		if (lane.detached) {
			return false;
		}

		const resolvedSessionId = lane.resolvedSessionId ?? context.sessionId;
		if (resolvedSessionId) {
			return (
				this.options.state.providerId === context.providerId &&
				this.options.state.sessionId === resolvedSessionId
			);
		}

		return this.options.state.matchesVisiblePromptContext(context);
	}

	private async runPromptInLane(
		lane: ExecutionLane,
		task: PromptExecution,
		context: RuntimePromptContext,
	) {
		const abortController = new AbortController();
		lane.activeAbort = abortController;
		lane.activeContext = context;
		let completedSessionId = lane.resolvedSessionId ?? context.sessionId;
		const resolveAutoTitleEarly = (sdkSessionId: string) => {
			if (!context.sessionId) {
				this.options.autoTitle?.resolveSession(
					context.ocSessionId,
					sdkSessionId,
				);
			}
		};
		const wrappedTask: PromptExecution = {
			...task,
			onEvent: (event) => {
				task.onEvent?.(event);
				if (event.type === "session_initialized") {
					completedSessionId = event.sessionId;
					lane.resolvedSessionId = event.sessionId;
					// Back-fill resolvedProviderId on the pending→resolved
					// transition so the next prompt's getOrCreateLane match
					// finds this lane by (providerId, sessionId) instead of
					// opening a duplicate lane for the same session.
					lane.resolvedProviderId = context.providerId;
					resolveAutoTitleEarly(event.sessionId);
				}
				if (event.type === "done") {
					completedSessionId = event.sessionId;
				}
			},
		};

		try {
			await this.options.promptDispatcher.run(
				wrappedTask,
				{
					...context,
					isVisible: () => this.isLaneVisible(lane, context),
					resumeSessionId: lane.resolvedSessionId ?? context.sessionId,
				},
				abortController,
			);
		} finally {
			if (completedSessionId) {
				lane.resolvedSessionId = completedSessionId;
				lane.resolvedProviderId = context.providerId;
				resolveAutoTitleEarly(completedSessionId);
			} else if (!context.sessionId) {
				if (abortController.signal.aborted && task.source === "browser") {
					this.options.autoTitle?.cancel(context.ocSessionId);
				} else if (
					abortController.signal.aborted &&
					(task.source === "browser" ||
						task.source === "telegram" ||
						task.source === "tui")
				) {
					this.options.autoTitle?.resolveSession(
						context.ocSessionId,
						context.ocSessionId,
					);
				} else {
					this.options.autoTitle?.cancel(context.ocSessionId);
				}
			}
			lane.activeAbort = undefined;
			lane.activeContext = undefined;
			if (lane.detached) {
				this.lanes.delete(lane.key);
			}
			this.options.onStatusChange?.();
		}
	}
}
