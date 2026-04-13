import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render, Text } from "ink";
import { useTerminalSize } from "../../../src/frontend/tui/use-terminal-size.ts";

function createOutputStream(columns: number, rows: number) {
	const stream = new PassThrough() as PassThrough &
		NodeJS.WriteStream & {
			columns: number;
			isTTY: boolean;
			rows: number;
		};
	stream.columns = columns;
	stream.isTTY = false;
	stream.rows = rows;
	return stream;
}

function TerminalSizeObserver() {
	const { columns, rows } = useTerminalSize();
	return <Text>{`${columns}x${rows}`}</Text>;
}

async function flushUpdates() {
	for (let index = 0; index < 20; index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

describe("useTerminalSize", () => {
	test("tracks the current terminal size and reacts to resize events", async () => {
		const stdout = createOutputStream(80, 24);
		const stderr = createOutputStream(80, 24);
		const stdin = new PassThrough() as unknown as NodeJS.ReadStream & {
			isTTY: boolean;
		};
		stdin.isTTY = false;
		let output = "";
		stdout.on("data", (chunk) => {
			output += chunk.toString();
		});

		const app = render(<TerminalSizeObserver />, {
			debug: true,
			exitOnCtrlC: false,
			maxFps: 1000,
			patchConsole: false,
			stderr,
			stdin,
			stdout,
		});

		try {
			await flushUpdates();
			expect(output).toContain("80x24");

			stdout.columns = 120;
			stdout.rows = 40;
			stdout.emit("resize");
			await flushUpdates();
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(output).toContain("120x40");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});
});
