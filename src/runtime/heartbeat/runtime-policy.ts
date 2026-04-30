type TimerHandle = unknown;

export type HeartbeatAttemptResult = "attempt" | "skip" | "defer";

interface HeartbeatRuntimePolicyOptions {
	clearTimeoutFn?: (timer: TimerHandle) => void;
	now?: () => number;
	setTimeoutFn?: (handler: () => void, timeout: number) => TimerHandle;
}

export class HeartbeatRuntimePolicy {
	private activeDeferMinutes = 0;
	private deferTimer: TimerHandle | undefined;
	private fireDeferredHeartbeat: (() => Promise<void> | void) | undefined;
	private heartbeatPending = false;
	private lastUserActivityAt: number;

	constructor(private readonly options: HeartbeatRuntimePolicyOptions = {}) {
		this.lastUserActivityAt = this.now();
	}

	beginShutdown() {
		this.clearDeferTimer();
		this.heartbeatPending = false;
	}

	completeHeartbeat() {
		this.heartbeatPending = false;
	}

	get userActivityAt(): number {
		return this.lastUserActivityAt;
	}

	markHeartbeatQueued() {
		this.heartbeatPending = true;
	}

	noteUserActivity() {
		this.lastUserActivityAt = this.now();
		this.resetDeferTimer();
	}

	queueRejected() {
		this.heartbeatPending = false;
	}

	setFireDeferredHeartbeat(handler: () => Promise<void> | void) {
		this.fireDeferredHeartbeat = handler;
	}

	shouldAttempt(
		hasActiveSession: boolean,
		scheduledAt: number,
		deferMinutes: number,
	): HeartbeatAttemptResult {
		if (!hasActiveSession || this.heartbeatPending) {
			return "skip";
		}

		if (deferMinutes === 0) {
			return "attempt";
		}

		if (scheduledAt - this.lastUserActivityAt >= deferMinutes * 60_000) {
			return "attempt";
		}

		return "defer";
	}

	startDeferTimer(deferMinutes: number) {
		this.clearDeferTimer();
		this.activeDeferMinutes = deferMinutes;
		const elapsed = this.now() - this.lastUserActivityAt;
		const delay = Math.max(deferMinutes * 60_000 - elapsed, 0);
		this.deferTimer = this.setTimeout(() => {
			this.deferTimer = undefined;
			void this.fireDeferredHeartbeat?.();
		}, delay);
	}

	private clearDeferTimer() {
		if (this.deferTimer === undefined) {
			return;
		}

		this.clearTimeout(this.deferTimer);
		this.deferTimer = undefined;
	}

	private clearTimeout(timer: TimerHandle) {
		const clearTimeoutFn =
			this.options.clearTimeoutFn ??
			((timerId: TimerHandle) =>
				clearTimeout(timerId as ReturnType<typeof setTimeout>));
		clearTimeoutFn(timer);
	}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	private resetDeferTimer() {
		if (this.deferTimer === undefined) {
			return;
		}
		this.clearDeferTimer();
		this.deferTimer = this.setTimeout(() => {
			this.deferTimer = undefined;
			void this.fireDeferredHeartbeat?.();
		}, this.activeDeferMinutes * 60_000);
	}

	private setTimeout(handler: () => void, timeout: number): TimerHandle {
		const setTimeoutFn =
			this.options.setTimeoutFn ??
			((callback: () => void, ms: number) => setTimeout(callback, ms));
		return setTimeoutFn(handler, timeout);
	}
}
