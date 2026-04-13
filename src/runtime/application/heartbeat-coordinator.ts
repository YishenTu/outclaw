type TimerHandle = ReturnType<typeof setTimeout>;

export class HeartbeatCoordinator {
	private activeDeferMinutes = 0;
	private deferTimer: TimerHandle | undefined;
	private fireDeferredHeartbeat: (() => Promise<void> | void) | undefined;
	private heartbeatPending = false;
	private lastUserActivityAt = Date.now();

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
		this.lastUserActivityAt = Date.now();
		this.resetDeferTimer();
	}

	queueRejected() {
		this.heartbeatPending = false;
	}

	setFireDeferredHeartbeat(handler: () => Promise<void> | void) {
		this.fireDeferredHeartbeat = handler;
	}

	shouldAttemptHeartbeat(
		hasActiveSession: boolean,
		scheduledAt: number,
		deferMinutes: number,
	): "attempt" | "skip" | "defer" {
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
		const elapsed = Date.now() - this.lastUserActivityAt;
		const delay = Math.max(deferMinutes * 60_000 - elapsed, 0);
		this.deferTimer = setTimeout(() => {
			this.deferTimer = undefined;
			void this.fireDeferredHeartbeat?.();
		}, delay);
	}

	private clearDeferTimer() {
		if (this.deferTimer !== undefined) {
			clearTimeout(this.deferTimer);
			this.deferTimer = undefined;
		}
	}

	private resetDeferTimer() {
		if (this.deferTimer === undefined) {
			return;
		}
		this.clearDeferTimer();
		this.deferTimer = setTimeout(() => {
			this.deferTimer = undefined;
			void this.fireDeferredHeartbeat?.();
		}, this.activeDeferMinutes * 60_000);
	}
}
