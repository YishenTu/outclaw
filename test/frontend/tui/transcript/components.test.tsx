import { afterEach, describe, expect, setSystemTime, test, vi } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import type { ReactElement } from "react";
import { MessageItem } from "../../../../src/frontend/tui/transcript/message-item.tsx";
import { MessageList } from "../../../../src/frontend/tui/transcript/message-list.tsx";

function createOutputStream() {
	const stream = new PassThrough() as PassThrough &
		NodeJS.WriteStream & {
			columns: number;
			isTTY: boolean;
			rows: number;
		};
	stream.columns = 80;
	stream.isTTY = false;
	stream.rows = 24;
	return stream;
}

async function flushUpdates() {
	for (let index = 0; index < 5; index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

function renderToOutput(element: ReactElement) {
	const stdout = createOutputStream();
	const stderr = createOutputStream();
	const stdin = new PassThrough() as unknown as NodeJS.ReadStream & {
		isTTY: boolean;
	};
	stdin.isTTY = false;
	let output = "";
	stdout.on("data", (chunk) => {
		output = chunk.toString();
	});

	const app = render(element, {
		exitOnCtrlC: false,
		patchConsole: false,
		stderr,
		stdin,
		stdout,
	});

	return {
		app,
		getOutput: () => output,
	};
}

describe("transcript components", () => {
	afterEach(() => {
		vi.useRealTimers();
		setSystemTime();
	});

	test("MessageItem renders wrapped user messages", async () => {
		const { app, getOutput } = renderToOutput(
			<MessageItem
				message={{ id: 1, role: "user", text: "alpha beta gamma" }}
				columns={12}
			/>,
		);

		try {
			await flushUpdates();
			expect(getOutput()).toContain("❯ alpha");
			expect(getOutput()).toContain("   beta");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("MessageItem renders assistant, info, and error variants", async () => {
		const { app, getOutput } = renderToOutput(
			<>
				<MessageItem
					message={{ id: 1, role: "assistant", text: "assistant reply" }}
					columns={40}
				/>
				<MessageItem
					message={{ id: 2, role: "info", text: "runtime status" }}
					columns={40}
				/>
				<MessageItem
					message={{ id: 3, role: "error", text: "broken" }}
					columns={40}
				/>
			</>,
		);

		try {
			await flushUpdates();
			expect(getOutput()).toContain("assistant reply");
			expect(getOutput()).toContain("runtime status");
			expect(getOutput()).toContain("✗ broken");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("MessageList shows streaming text before the spinner", async () => {
		const { app, getOutput } = renderToOutput(
			<MessageList
				messages={[{ id: 1, role: "assistant", text: "done" }]}
				streaming="partial response"
				running={true}
				columns={40}
			/>,
		);

		try {
			await flushUpdates();
			expect(getOutput()).toContain("done");
			expect(getOutput()).toContain("partial response");
			expect(getOutput()).not.toContain("Thinking...");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("MessageList renders the spinner when running without streaming", async () => {
		const now = new Date("2026-04-11T00:00:00Z");
		setSystemTime(now);
		vi.useFakeTimers({ now });

		const { app, getOutput } = renderToOutput(
			<MessageList messages={[]} streaming="" running={true} columns={40} />,
		);

		try {
			await flushUpdates();
			const firstFrame = getOutput();
			expect(firstFrame).toContain("Thinking...");

			vi.advanceTimersByTime(80);
			await flushUpdates();
			expect(getOutput()).toContain("Thinking...");
			expect(getOutput()).not.toBe(firstFrame);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});
});
