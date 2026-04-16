import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import type { TextAreaInputEvent } from "../../../../src/frontend/tui/composer/input.ts";

function createMockStdin() {
	const stream = new PassThrough() as PassThrough & {
		isTTY: boolean;
		setRawMode: (mode: boolean) => void;
		ref: () => void;
		unref: () => void;
	};
	stream.isTTY = true;
	stream.setRawMode = () => {};
	stream.ref = () => {};
	stream.unref = () => {};
	stream.setEncoding("utf8");
	return stream;
}

async function nextTick() {
	await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("batch delivery", () => {
	test("multiple characters in one chunk are delivered as a single batch", async () => {
		const stdin = createMockStdin();
		const { getInputManager } = await import(
			"../../../../src/frontend/tui/composer/input.ts"
		);
		const manager = getInputManager(stdin as never);
		const batches: TextAreaInputEvent[][] = [];
		const unsub = manager.subscribe((events: TextAreaInputEvent[]) => {
			batches.push([...events]);
		});

		// "abc" with no escape sequences → parser yields one chunk "abc"
		// which normalizes to one event. Single batch of 1 event.
		stdin.push("abc");
		await nextTick();

		const firstBatch = batches[0];
		expect(batches).toHaveLength(1);
		expect(firstBatch?.length).toBe(1);
		expect(firstBatch?.[0]?.input).toBe("abc");

		unsub();
	});

	test("characters interleaved with escape sequences are delivered as a single batch", async () => {
		const stdin = createMockStdin();
		const { getInputManager } = await import(
			"../../../../src/frontend/tui/composer/input.ts"
		);
		const manager = getInputManager(stdin as never);
		const batches: TextAreaInputEvent[][] = [];
		const unsub = manager.subscribe((events: TextAreaInputEvent[]) => {
			batches.push([...events]);
		});

		// "f" + up-arrow + "e" → parser splits into 3 sequences → 3 events
		// All delivered in ONE batch from one handleReadable call.
		stdin.push("f\x1b[Ae");
		await nextTick();

		const firstBatch = batches[0];
		expect(batches).toHaveLength(1);
		expect(firstBatch?.length).toBe(3);
		expect(firstBatch?.[0]?.input).toBe("f");
		expect(firstBatch?.[1]?.key.upArrow).toBe(true);
		expect(firstBatch?.[2]?.input).toBe("e");

		unsub();
	});

	test("batch reduction eliminates stale-closure character loss", async () => {
		const stdin = createMockStdin();
		const { getInputManager } = await import(
			"../../../../src/frontend/tui/composer/input.ts"
		);
		const manager = getInputManager(stdin as never);

		// Simulate a consumer that reduces a batch over draft state.
		// This is the pattern app.tsx uses — thread state through the batch.
		let composerValue = "";
		const unsub = manager.subscribe((events: TextAreaInputEvent[]) => {
			let draft = composerValue;
			for (const event of events) {
				if (event.input.length > 0 && !event.key.upArrow) {
					draft += event.input;
				}
			}
			composerValue = draft;
		});

		// "f" + up-arrow + "e" in one burst
		stdin.push("f\x1b[Ae");
		await nextTick();

		expect(composerValue).toBe("fe");

		unsub();
	});
});
