import type { Config } from "../config.ts";
import { readHeartbeatPrompt } from "./read-heartbeat-prompt.ts";

type TimerHandle = unknown;

interface HeartbeatSchedulerOptions {
	config: Config["heartbeat"];
	promptHomeDir: string;
	now?: () => number;
	clearIntervalFn?: (timer: TimerHandle) => void;
	readHeartbeatPrompt?: (promptHomeDir: string) => Promise<string | undefined>;
	requestHeartbeat: (
		prompt: string,
		scheduledAt: number,
		deferMinutes: number,
	) => Promise<boolean> | boolean;
	setIntervalFn?: (handler: () => void, timeout?: number) => TimerHandle;
	shouldAttemptHeartbeat: (
		scheduledAt: number,
		deferMinutes: number,
	) => boolean;
}

export class HeartbeatScheduler {
	private intervalId: TimerHandle | undefined;

	constructor(private options: HeartbeatSchedulerOptions) {}

	start() {
		if (this.options.config.intervalMinutes === 0) {
			return;
		}

		void this.tick();
		const setIntervalFn =
			this.options.setIntervalFn ??
			((handler: () => void, timeout?: number) =>
				setInterval(handler, timeout));
		this.intervalId = setIntervalFn(() => {
			void this.tick();
		}, this.options.config.intervalMinutes * 60_000);
	}

	stop() {
		if (!this.intervalId) {
			return;
		}

		const clearIntervalFn =
			this.options.clearIntervalFn ??
			((timer: TimerHandle) =>
				clearInterval(timer as ReturnType<typeof setInterval>));
		clearIntervalFn(this.intervalId);
		this.intervalId = undefined;
	}

	async tick() {
		if (this.options.config.intervalMinutes === 0) {
			return;
		}

		const scheduledAt = (this.options.now ?? Date.now)();
		if (
			!this.options.shouldAttemptHeartbeat(
				scheduledAt,
				this.options.config.deferMinutes,
			)
		) {
			return;
		}

		const prompt = await (
			this.options.readHeartbeatPrompt ?? readHeartbeatPrompt
		)(this.options.promptHomeDir);
		if (!prompt) {
			return;
		}

		await this.options.requestHeartbeat(
			prompt,
			scheduledAt,
			this.options.config.deferMinutes,
		);
	}
}
