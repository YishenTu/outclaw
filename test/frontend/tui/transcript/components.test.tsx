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

	test("MessageItem renders reply context before the user message", async () => {
		const { app, getOutput } = renderToOutput(
			<MessageItem
				message={{
					id: 1,
					role: "user",
					replyText: "earlier message",
					text: "[telegram] what do you mean?",
				}}
				columns={50}
			/>,
		);

		try {
			await flushUpdates();
			const output = getOutput();
			expect(output).toContain("Reply");
			expect(output).toContain("   earlier message");
			expect(output).toContain("[telegram] what do you mean?");
			expect(output.indexOf("Reply")).toBeLessThan(
				output.indexOf("[telegram] what do you mean?"),
			);
			expect(output).not.toContain("---");
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

	test("MessageItem renders compact boundary info with extra spacing", async () => {
		const { app, getOutput } = renderToOutput(
			<MessageItem
				message={{
					id: 1,
					role: "info",
					text: "context compacted",
					variant: "compact_boundary",
				}}
				columns={40}
			/>,
		);

		try {
			await flushUpdates();
			const output = getOutput();
			expect(output).toContain("\n");
			expect(output).toContain("   ~ context compacted ~");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("MessageItem renders aligned status messages", async () => {
		const { app, getOutput } = renderToOutput(
			<MessageItem
				message={{
					id: 1,
					role: "status",
					text: "Runtime\nModel        opus\nEffort       think",
				}}
				columns={40}
			/>,
		);

		try {
			await flushUpdates();
			const output = getOutput();
			expect(output).toContain("Runtime");
			expect(output).toContain("Model");
			expect(output).toContain("opus");
			expect(output).toContain("Effort");
			expect(output).toContain("think");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("MessageItem status rendering does not trigger React key warnings", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { app } = renderToOutput(
			<MessageItem
				message={{
					id: 1,
					role: "status",
					text: "Runtime\nModel        opus\nEffort       think",
				}}
				columns={40}
			/>,
		);

		try {
			await flushUpdates();
			const combinedErrors = errorSpy.mock.calls.flat().join(" ");
			expect(combinedErrors).not.toContain('unique "key" prop');
		} finally {
			app.unmount();
			app.cleanup();
			errorSpy.mockRestore();
		}
	});

	test("MessageItem renders markdown in thinking messages", async () => {
		const { app, getOutput } = renderToOutput(
			<MessageItem
				message={{ id: 1, role: "thinking", text: "**bold** and `code`" }}
				columns={40}
			/>,
		);

		try {
			await flushUpdates();
			const output = getOutput();
			expect(output).toContain("bold");
			expect(output).toContain("code");
			expect(output).not.toContain("**bold**");
			expect(output).not.toContain("`code`");
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
				streamingThinking=""
				compacting={false}
				running={true}
				columns={40}
			/>,
		);

		try {
			await flushUpdates();
			expect(getOutput()).toContain("done");
			expect(getOutput()).toContain("partial response");
			expect(getOutput()).toContain("Working...");
			expect(getOutput()).not.toContain("Thinking...");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("MessageList renders markdown in streaming text", async () => {
		const { app, getOutput } = renderToOutput(
			<MessageList
				messages={[]}
				streaming="**bold** and `code`"
				streamingThinking=""
				compacting={false}
				running={true}
				columns={40}
			/>,
		);

		try {
			await flushUpdates();
			const output = getOutput();
			expect(output).toContain("bold");
			expect(output).toContain("code");
			expect(output).not.toContain("**bold**");
			expect(output).not.toContain("`code`");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("MessageList renders markdown in streaming thinking", async () => {
		const { app, getOutput } = renderToOutput(
			<MessageList
				messages={[]}
				streaming=""
				streamingThinking="**bold** and `code`"
				compacting={false}
				running={true}
				columns={40}
			/>,
		);

		try {
			await flushUpdates();
			const output = getOutput();
			expect(output).toContain("bold");
			expect(output).toContain("code");
			expect(output).not.toContain("**bold**");
			expect(output).not.toContain("`code`");
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
			<MessageList
				messages={[]}
				streaming=""
				streamingThinking=""
				compacting={false}
				running={true}
				columns={40}
			/>,
		);

		try {
			await flushUpdates();
			const firstFrame = getOutput();
			expect(firstFrame).toContain("Thinking...");
			expect(firstFrame).not.toContain("Working...");

			vi.advanceTimersByTime(80);
			await flushUpdates();
			expect(getOutput()).toContain("Thinking...");
			expect(getOutput()).not.toBe(firstFrame);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("MessageList renders the full transcript in flow order", async () => {
		const { app, getOutput } = renderToOutput(
			<MessageList
				messages={[
					{ id: 1, role: "info", text: "history 1" },
					{ id: 2, role: "info", text: "history 2" },
					{ id: 3, role: "info", text: "history 3" },
					{ id: 4, role: "info", text: "history 4" },
				]}
				streaming=""
				streamingThinking=""
				compacting={false}
				running={false}
				columns={40}
			/>,
		);

		try {
			await flushUpdates();
			const output = getOutput();
			expect(output).toContain("history 1");
			expect(output).toContain("history 2");
			expect(output).toContain("history 3");
			expect(output).toContain("history 4");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});
});
