import { describe, expect, test } from "bun:test";
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

	test("MessageList renders markdown in streaming text", async () => {
		const { app, getOutput } = renderToOutput(
			<MessageList
				messages={[]}
				streaming="**bold** and `code`"
				streamingThinking=""
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
		const { app, getOutput } = renderToOutput(
			<MessageList
				messages={[]}
				streaming=""
				streamingThinking=""
				running={true}
				columns={40}
			/>,
		);

		try {
			await flushUpdates();
			expect(getOutput()).toContain("Thinking...");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});
});
