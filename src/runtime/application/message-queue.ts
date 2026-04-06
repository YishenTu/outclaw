type Task = () => Promise<void>;

export class MessageQueue {
	private queue: Task[] = [];
	private processing = false;
	private drainResolvers: Array<() => void> = [];

	enqueue(task: Task) {
		this.queue.push(task);
		this.process();
	}

	drain(): Promise<void> {
		if (!this.processing && this.queue.length === 0) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			this.drainResolvers.push(resolve);
		});
	}

	private async process() {
		if (this.processing) return;
		this.processing = true;

		while (this.queue.length > 0) {
			const task = this.queue.shift();
			if (!task) break;
			try {
				await task();
			} catch {
				// Task errors are swallowed — callers handle their own errors
			}
		}

		this.processing = false;

		for (const resolve of this.drainResolvers) {
			resolve();
		}
		this.drainResolvers = [];
	}
}
