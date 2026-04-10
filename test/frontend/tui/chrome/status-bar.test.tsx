import { afterEach, describe, expect, setSystemTime, test, vi } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { StatusBar } from "../../../../src/frontend/tui/chrome/status-bar.tsx";

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

function renderStatusBar(props: Parameters<typeof StatusBar>[0]) {
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

	const app = render(<StatusBar {...props} />, {
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

describe("StatusBar", () => {
	afterEach(() => {
		vi.useRealTimers();
		setSystemTime();
	});

	test("renders connection and runtime info", async () => {
		const { app, getOutput } = renderStatusBar({
			status: "connected",
			info: { model: "opus", effort: "high", contextPercentage: 6 },
		});

		try {
			await flushUpdates();
			expect(getOutput()).toContain("connected");
			expect(getOutput()).toContain("opus");
			expect(getOutput()).toContain("high");
			expect(getOutput()).toContain("6% context");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("updates the heartbeat countdown over time", async () => {
		const now = new Date("2026-04-11T00:00:00Z");
		setSystemTime(now);
		vi.useFakeTimers({ now });

		const { app, getOutput } = renderStatusBar({
			status: "connected",
			info: { nextHeartbeatAt: now.getTime() + 60_000 },
		});

		try {
			await flushUpdates();
			expect(getOutput()).toContain("♥ 1m");

			vi.advanceTimersByTime(60_000);
			await flushUpdates();
			expect(getOutput()).toContain("♥ 0m");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});
});
