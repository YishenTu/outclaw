import { HeartbeatCoordinator } from "./heartbeat-coordinator.ts";
import { MessageQueue } from "./message-queue.ts";
import type { PromptDispatcher, PromptExecution } from "./prompt-dispatcher.ts";
import type { RuntimeState } from "./runtime-state.ts";

interface HeartbeatTask {
	prompt: string;
	scheduledAt: number;
	sessionId: string;
}

interface RuntimeExecutionCoordinatorOptions {
	promptDispatcher: PromptDispatcher;
	state: RuntimeState;
}

export class RuntimeExecutionCoordinator {
	private activeAbort: AbortController | undefined;
	private heartbeatCoordinator = new HeartbeatCoordinator();
	private queue = new MessageQueue();
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
		this.options.state.preparePrompt(task.prompt, task.images);
		this.heartbeatCoordinator.noteUserActivity();
		this.queue.enqueue(() => this.runPrompt(task));
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
		}
	}
}
