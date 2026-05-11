import type { CodexServerNotification } from "./types.ts";

export class CodexNotificationQueue
	implements AsyncIterable<CodexServerNotification>
{
	private readonly items: CodexServerNotification[] = [];
	private readonly waiters: Array<
		(notification: CodexServerNotification | undefined) => void
	> = [];
	private closed = false;

	push(notification: CodexServerNotification): void {
		if (this.closed) {
			return;
		}

		const waiter = this.waiters.shift();
		if (waiter) {
			waiter(notification);
			return;
		}

		this.items.push(notification);
	}

	close(): void {
		if (this.closed) {
			return;
		}

		this.closed = true;
		for (const waiter of this.waiters.splice(0)) {
			waiter(undefined);
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<CodexServerNotification> {
		while (true) {
			const notification = await this.next();
			if (!notification) {
				return;
			}
			yield notification;
		}
	}

	private next(): Promise<CodexServerNotification | undefined> {
		const item = this.items.shift();
		if (item) {
			return Promise.resolve(item);
		}
		if (this.closed) {
			return Promise.resolve(undefined);
		}
		return new Promise((resolve) => {
			this.waiters.push(resolve);
		});
	}
}
