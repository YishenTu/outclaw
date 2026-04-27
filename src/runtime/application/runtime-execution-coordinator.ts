import { extractError } from "../../common/protocol.ts";
import { HeartbeatCoordinator } from "./heartbeat-coordinator.ts";
import { MessageQueue } from "./message-queue.ts";
import type { PromptDispatcher, PromptExecution } from "./prompt-dispatcher.ts";
import type { RuntimePromptContext, RuntimeState } from "./runtime-state.ts";
import type { SessionService } from "./session-service.ts";

interface HeartbeatTask {
	prompt: string;
	scheduledAt: number;
	sessionId: string;
}

interface RuntimeExecutionCoordinatorOptions {
	deliverRolloverNotice?: (params: {
		telegramChatId: number;
		text: string;
	}) => Promise<void> | void;
	onStatusChange?: () => void;
	promptDispatcher: Pick<PromptDispatcher, "run">;
	sessions: Pick<
		SessionService,
		| "beginRolloverAttempt"
		| "finishRolloverAttempt"
		| "recordAcceptedPromptTarget"
	>;
	state: RuntimeState;
}

interface ExecutionLane {
	activeAbort?: AbortController;
	activeContext?: RuntimePromptContext;
	key: string;
	queue: MessageQueue;
	resolvedSessionId?: string;
}

export class RuntimeExecutionCoordinator {
	private heartbeatCoordinator = new HeartbeatCoordinator();
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
		this.heartbeatCoordinator.beginShutdown();
		for (const lane of this.lanes.values()) {
			lane.activeAbort?.abort();
			lane.queue.close(true);
		}
	}

	drain(): Promise<void> {
		return Promise.all(
			[...this.lanes.values()].map((lane) => lane.queue.drain()),
		).then(() => undefined);
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

		this.heartbeatCoordinator.markHeartbeatQueued();
		const queued = lane.queue.enqueue(() =>
			this.runHeartbeat(lane, context, {
				prompt,
				scheduledAt,
				sessionId,
			}),
		);
		if (!queued) {
			this.heartbeatCoordinator.queueRejected();
		}
		return queued;
	}

	enqueuePrompt(task: PromptExecution) {
		if (this.shuttingDown) {
			return;
		}
		this.options.state.preparePrompt(task.prompt, task.images);
		const context = this.options.state.capturePromptContext();
		const lane = this.getOrCreateLane(context);
		this.heartbeatCoordinator.noteUserActivity();
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

	setRolloverNoticeHandler(
		handler: RuntimeExecutionCoordinatorOptions["deliverRolloverNotice"],
	) {
		this.deliverRolloverNotice = handler;
	}

	setFireDeferredHeartbeat(handler: () => Promise<void> | void) {
		this.heartbeatCoordinator.setFireDeferredHeartbeat(handler);
	}

	shouldAttemptHeartbeat(
		scheduledAt: number,
		deferMinutes: number,
	): "attempt" | "skip" | "defer" {
		return this.heartbeatCoordinator.shouldAttemptHeartbeat(
			this.options.state.sessionId !== undefined,
			scheduledAt,
			deferMinutes,
		);
	}

	startDeferTimer(deferMinutes: number) {
		this.heartbeatCoordinator.startDeferTimer(deferMinutes);
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
			if (this.heartbeatCoordinator.userActivityAt > task.scheduledAt) {
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
			this.heartbeatCoordinator.completeHeartbeat();
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
			void this.deliverRolloverStartedNotice(deliveryTarget, notice);
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

	private getOrCreateLane(context: RuntimePromptContext): ExecutionLane {
		const key = context.sessionId ?? `pending:${context.generation}`;
		const existing =
			context.sessionId === undefined
				? this.lanes.get(key)
				: [...this.lanes.values()].find(
						(lane) =>
							lane.resolvedSessionId === context.sessionId || lane.key === key,
					);
		if (existing) {
			if (context.sessionId) {
				existing.resolvedSessionId = context.sessionId;
			}
			return existing;
		}

		const lane: ExecutionLane = {
			key,
			queue: new MessageQueue(),
			resolvedSessionId: context.sessionId,
		};
		this.lanes.set(key, lane);
		return lane;
	}

	private isLaneVisible(
		lane: ExecutionLane,
		context: RuntimePromptContext,
	): boolean {
		const resolvedSessionId = lane.resolvedSessionId ?? context.sessionId;
		if (resolvedSessionId) {
			return this.options.state.sessionId === resolvedSessionId;
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
		const wrappedTask: PromptExecution = {
			...task,
			onEvent: (event) => {
				task.onEvent?.(event);
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
			}
			lane.activeAbort = undefined;
			lane.activeContext = undefined;
			this.options.onStatusChange?.();
		}
	}
}
