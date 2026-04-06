import { describe, expect, test } from "bun:test";
import { MessageQueue } from "../../src/runtime/queue.ts";

describe("MessageQueue", () => {
	test("processes tasks in order", async () => {
		const queue = new MessageQueue();
		const order: number[] = [];

		queue.enqueue(async () => {
			await new Promise((r) => setTimeout(r, 20));
			order.push(1);
		});
		queue.enqueue(async () => {
			order.push(2);
		});
		queue.enqueue(async () => {
			order.push(3);
		});

		await queue.drain();

		expect(order).toEqual([1, 2, 3]);
	});

	test("processes one at a time", async () => {
		const queue = new MessageQueue();
		let concurrent = 0;
		let maxConcurrent = 0;

		const task = async () => {
			concurrent++;
			maxConcurrent = Math.max(maxConcurrent, concurrent);
			await new Promise((r) => setTimeout(r, 10));
			concurrent--;
		};

		queue.enqueue(task);
		queue.enqueue(task);
		queue.enqueue(task);

		await queue.drain();

		expect(maxConcurrent).toBe(1);
	});

	test("continues processing after a task throws", async () => {
		const queue = new MessageQueue();
		const results: string[] = [];

		queue.enqueue(async () => {
			results.push("first");
		});
		queue.enqueue(async () => {
			throw new Error("fail");
		});
		queue.enqueue(async () => {
			results.push("third");
		});

		await queue.drain();

		expect(results).toEqual(["first", "third"]);
	});

	test("drain resolves immediately when empty", async () => {
		const queue = new MessageQueue();
		await queue.drain();
	});
});
