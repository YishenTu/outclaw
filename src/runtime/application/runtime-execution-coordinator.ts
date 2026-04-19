import { HeartbeatCoordinator } from "./heartbeat-coordinator.ts";
import { MessageQueue } from "./message-queue.ts";
import type { PromptDispatcher, PromptExecution } from "./prompt-dispatcher.ts";
import type { RuntimeState } from "./runtime-state.ts";
import type { SessionService } from "./session-service.ts";

interface HeartbeatTask {
	prompt: string;
	scheduledAt: number;
	sessionId: string;
}

interface RuntimeExecutionCoordinatorOptions {
	onStatusChange?: () => void;
	promptDispatcher: Pick<PromptDispatcher, "run">;
	sessions: Pick<
		SessionService,
		"finishRolloverAttempt" | "recordAcceptedPromptTarget"
	>;
	state: RuntimeState;
}

export class RuntimeExecutionCoordinator {
	private activeAbort: AbortController | undefined;
	private heartbeatCoordinator = new HeartbeatCoordinator();
	private queue = new MessageQueue();
	private rolloverQueued = false;
	private shuttingDown = false;

	constructor(private readonly options: RuntimeExecutionCoordinatorOptions) {}

	get isShuttingDown(): boolean {
		return this.shuttingDown;
	}

	get hasActiveRun(): boolean {
		return this.activeAbort !== undefined;
	}

	abortActiveRun(): boolean {
		if (!this.activeAbort) {
			return false;
		}

		this.activeAbort.abort();
		return true;
	}

	beginShutdown() {
		if (this.shuttingDown) {
			return;
		}
		this.shuttingDown = true;
		this.heartbeatCoordinator.beginShutdown();
		this.activeAbort?.abort();
		this.queue.close(true);
	}

	drain(): Promise<void> {
		return this.queue.drain();
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

		const sessionId = this.options.state.sessionId;
		if (!sessionId) {
			return false;
		}

		this.heartbeatCoordinator.markHeartbeatQueued();
		const queued = this.queue.enqueue(() =>
			this.runHeartbeat({
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
		this.queue.enqueue(
			() => this.runPrompt(task),
			() => {
				this.options.state.preparePrompt(task.prompt, task.images);
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
			},
		);
	}

	enqueueRollover(prompt: string, idleMinutes: number): boolean {
		if (
			this.shuttingDown ||
			this.rolloverQueued ||
			this.activeAbort !== undefined ||
			this.options.state.sessionId === undefined
		) {
			return false;
		}

		this.rolloverQueued = true;
		const queued = this.queue.enqueue(() =>
			this.runRollover({ idleMinutes, prompt }),
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
			const queued = this.queue.enqueue(
				async () => {
					await this.runPrompt(wrappedTask);
					if (!failed) {
						resolve(responseText);
					}
				},
				() => {
					this.options.state.preparePrompt(
						wrappedTask.prompt,
						wrappedTask.images,
					);
				},
			);
			if (!queued) {
				reject(new Error("Runtime shutting down"));
			}
		});
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

	private async runHeartbeat(task: HeartbeatTask) {
		try {
			if (this.options.state.sessionId !== task.sessionId) {
				return;
			}
			if (this.heartbeatCoordinator.userActivityAt > task.scheduledAt) {
				return;
			}

			this.options.state.preparePrompt(task.prompt);
			await this.runPrompt({
				prompt: task.prompt,
				source: "heartbeat",
			});
		} finally {
			this.heartbeatCoordinator.completeHeartbeat();
		}
	}

	private async runRollover(task: { idleMinutes: number; prompt: string }) {
		let failed = true;
		let started = false;

		try {
			if (this.options.state.sessionId === undefined) {
				return;
			}

			started = true;
			await this.runPrompt({
				onEvent: (event) => {
					if (event.type === "done") {
						failed = false;
					}
				},
				prompt: task.prompt,
				source: "rollover",
			});
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

	private async runPrompt(task: PromptExecution) {
		const abortController = new AbortController();
		this.activeAbort = abortController;

		try {
			await this.options.promptDispatcher.run(
				task,
				this.options.state.generation,
				abortController,
			);
		} finally {
			this.activeAbort = undefined;
			this.options.onStatusChange?.();
		}
	}
}
