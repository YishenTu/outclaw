import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { createHeartbeatPrompt } from "./create-heartbeat-prompt.ts";

type TimerHandle = unknown;

export type HeartbeatAttemptResult = "attempt" | "skip" | "defer";

interface HeartbeatSchedulerOptions {
	config: Config["heartbeat"];
	promptHomeDir: string;
	now?: () => number;
	clearTimeoutFn?: (timer: TimerHandle) => void;
	hasHeartbeatContent?: () => boolean;
	onDeferred?: (deferMinutes: number) => void;
	onStatusChange?: () => void;
	requestHeartbeat: (
		prompt: string,
		scheduledAt: number,
		deferMinutes: number,
	) => Promise<boolean> | boolean;
	setTimeoutFn?: (handler: () => void, timeout: number) => TimerHandle;
	shouldAttemptHeartbeat: (
		scheduledAt: number,
		deferMinutes: number,
	) => HeartbeatAttemptResult;
}

export function hasHeartbeatContent(promptHomeDir: string): boolean {
	const path = join(promptHomeDir, "HEARTBEAT.md");
	if (!existsSync(path)) return false;
	return readFileSync(path, "utf-8").trim().length > 0;
}

export class HeartbeatScheduler {
	private timerId: TimerHandle | undefined;
	private _nextHeartbeatAt: number | undefined;
	private _deferred = false;

	constructor(private options: HeartbeatSchedulerOptions) {}

	get nextHeartbeatAt(): number | undefined {
		return this._nextHeartbeatAt;
	}

	get deferred(): boolean {
		return this._deferred;
	}

	private setDeferred(deferred: boolean) {
		if (this._deferred === deferred) {
			return;
		}

		this._deferred = deferred;
		this.options.onStatusChange?.();
	}

	private setNextHeartbeatAt(nextHeartbeatAt: number | undefined) {
		if (this._nextHeartbeatAt === nextHeartbeatAt) {
			return;
		}

		this._nextHeartbeatAt = nextHeartbeatAt;
		this.options.onStatusChange?.();
	}

	start() {
		if (this.options.config.intervalMinutes === 0) {
			return;
		}

		const intervalMs = this.options.config.intervalMinutes * 60_000;

		if (this.hasContent()) {
			const now = (this.options.now ?? Date.now)();
			this.setNextHeartbeatAt(now + intervalMs);
		}

		this.scheduleTimer(intervalMs);
	}

	stop() {
		this.cancelTimer();
		this.setDeferred(false);
		this.setNextHeartbeatAt(undefined);
	}

	async tick() {
		if (this.options.config.intervalMinutes === 0) {
			return;
		}

		const intervalMs = this.options.config.intervalMinutes * 60_000;

		if (!this.hasContent()) {
			this.setDeferred(false);
			this.setNextHeartbeatAt(undefined);
			this.scheduleTimer(intervalMs);
			return;
		}

		const scheduledAt = (this.options.now ?? Date.now)();

		const result = this.options.shouldAttemptHeartbeat(
			scheduledAt,
			this.options.config.deferMinutes,
		);

		if (result === "defer") {
			this.setDeferred(true);
			this.options.onDeferred?.(this.options.config.deferMinutes);
			// No timer scheduled — controller will call fireDeferred() when ready
			return;
		}

		if (result === "skip") {
			this.setDeferred(false);
			this.setNextHeartbeatAt(scheduledAt + intervalMs);
			this.scheduleTimer(intervalMs);
			return;
		}

		await this.fireHeartbeat(scheduledAt);
	}

	async fireDeferred() {
		const intervalMs = this.options.config.intervalMinutes * 60_000;

		if (!this.hasContent()) {
			this.setDeferred(false);
			this.setNextHeartbeatAt(undefined);
			this.scheduleTimer(intervalMs);
			return;
		}

		const scheduledAt = (this.options.now ?? Date.now)();
		await this.fireHeartbeat(scheduledAt);
	}

	private async fireHeartbeat(scheduledAt: number) {
		const intervalMs = this.options.config.intervalMinutes * 60_000;

		this.setDeferred(false);
		const prompt = createHeartbeatPrompt(this.options.promptHomeDir);
		await this.options.requestHeartbeat(
			prompt,
			scheduledAt,
			this.options.config.deferMinutes,
		);
		this.setNextHeartbeatAt(scheduledAt + intervalMs);
		this.scheduleTimer(intervalMs);
	}

	private scheduleTimer(ms: number) {
		this.cancelTimer();
		const setTimeoutFn =
			this.options.setTimeoutFn ??
			((handler: () => void, timeout: number) => setTimeout(handler, timeout));
		this.timerId = setTimeoutFn(() => {
			void this.tick();
		}, ms);
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

	private hasContent(): boolean {
		if (!this.options.hasHeartbeatContent) {
			return true;
		}
		return this.options.hasHeartbeatContent();
	}
}
