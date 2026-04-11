type Task = () => Promise<void>;

export class MessageQueue {
	private queue: Task[] = [];
	private processing = false;
	private closed = false;
	private drainResolvers: Array<() => void> = [];

	enqueue(task: Task): boolean {
		if (this.closed) {
			return false;
		}
		this.queue.push(task);
		this.process();
		return true;
	}

	close(discardPending = false) {
		this.closed = true;
		if (discardPending) {
			this.queue = [];
		}
		if (!this.processing && this.queue.length === 0) {
			this.resolveDrainers();
		}
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
		this.resolveDrainers();
	}

	private resolveDrainers() {
		for (const resolve of this.drainResolvers) {
			resolve();
		}
		this.drainResolvers = [];
	}
}
