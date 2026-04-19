import { createRolloverPrompt } from "./create-rollover-prompt.ts";

type TimerHandle = unknown;

interface RolloverSchedulerOptions {
	config: {
		idleMinutes: number;
	};
	clearTimeoutFn?: (timer: TimerHandle) => void;
	getLastHandledInteractiveAt: () => number | undefined;
	getLastInteractiveAt: () => number | undefined;
	hasActiveRun: () => boolean;
	hasActiveSession: () => boolean;
	now?: () => number;
	requestRollover: (prompt: string) => Promise<boolean> | boolean;
	setTimeoutFn?: (handler: () => void, timeout: number) => TimerHandle;
}

export class RolloverScheduler {
	private timerId: TimerHandle | undefined;

	constructor(private readonly options: RolloverSchedulerOptions) {}

	start() {
		this.noteStateChanged();
	}

	stop() {
		this.cancelTimer();
	}

	noteStateChanged() {
		this.cancelTimer();

		const dueAt = this.getDueAt();
		if (dueAt === undefined) {
			return;
		}

		const now = (this.options.now ?? Date.now)();
		if (now >= dueAt) {
			void this.attemptRollover();
			return;
		}

		const setTimeoutFn =
			this.options.setTimeoutFn ??
			((handler: () => void, timeout: number) => setTimeout(handler, timeout));
		this.timerId = setTimeoutFn(() => {
			this.timerId = undefined;
			void this.attemptRollover();
		}, dueAt - now);
	}

	private async attemptRollover() {
		if (this.getDueAt() === undefined) {
			return;
		}
		if (this.options.hasActiveRun() || !this.options.hasActiveSession()) {
			return;
		}

		await this.options.requestRollover(createRolloverPrompt());
	}

	private getDueAt(): number | undefined {
		if (this.options.config.idleMinutes === 0) {
			return undefined;
		}

		const lastInteractiveAt = this.options.getLastInteractiveAt();
		if (lastInteractiveAt === undefined) {
			return undefined;
		}
		if (this.options.getLastHandledInteractiveAt() === lastInteractiveAt) {
			return undefined;
		}

		return lastInteractiveAt + this.options.config.idleMinutes * 60_000;
	}

	private cancelTimer() {
		if (this.timerId === undefined) {
			return;
		}

		const clearTimeoutFn =
			this.options.clearTimeoutFn ??
			((timer: TimerHandle) =>
				clearTimeout(timer as ReturnType<typeof setTimeout>));
		clearTimeoutFn(this.timerId);
		this.timerId = undefined;
	}
}
