import { afterEach, describe, expect, setSystemTime, test, vi } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import {
	contextWarningColor,
	StatusBar,
} from "../../../../src/frontend/tui/chrome/status-bar.tsx";

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
			info: {
				agentName: "railly",
				model: "opus",
				effort: "high",
				contextTokens: 12_000,
				contextWindow: 200_000,
			},
		});

		try {
			await flushUpdates();
			expect(getOutput()).toContain("connected");
			expect(getOutput()).toContain("@railly");
			expect(getOutput()).toContain("opus");
			expect(getOutput()).toContain("high");
			expect(getOutput().indexOf("@railly")).toBeLessThan(
				getOutput().indexOf("opus"),
			);
			expect(getOutput()).toContain("12k/200k (6%)");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("hides context for a fresh session with no usage yet", async () => {
		const { app, getOutput } = renderStatusBar({
			status: "connected",
			info: {
				model: "opus",
				effort: "high",
			},
		});

		try {
			await flushUpdates();
			expect(getOutput()).toContain("connected");
			expect(getOutput()).toContain("opus");
			expect(getOutput()).toContain("high");
			expect(getOutput()).not.toContain("n/a");
			expect(getOutput()).not.toContain("/");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("contextWarningColor returns undefined below 65%", () => {
		expect(contextWarningColor(0)).toBeUndefined();
		expect(contextWarningColor(50)).toBeUndefined();
		expect(contextWarningColor(64)).toBeUndefined();
	});

	test("contextWarningColor returns yellow between 65-74%", () => {
		expect(contextWarningColor(65)).toBe("yellow");
		expect(contextWarningColor(70)).toBe("yellow");
		expect(contextWarningColor(74)).toBe("yellow");
	});

	test("contextWarningColor returns red at 75%+", () => {
		expect(contextWarningColor(75)).toBe("red");
		expect(contextWarningColor(80)).toBe("red");
		expect(contextWarningColor(100)).toBe("red");
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

	test("renders heartbeat as the right-most status item", async () => {
		const now = new Date("2026-04-11T00:00:00Z");
		setSystemTime(now);
		vi.useFakeTimers({ now });

		const { app, getOutput } = renderStatusBar({
			status: "connected",
			info: {
				agentName: "railly",
				model: "opus",
				effort: "high",
				contextTokens: 12_000,
				contextWindow: 200_000,
				nextHeartbeatAt: now.getTime() + 60_000,
			},
		});

		try {
			await flushUpdates();
			const output = getOutput();
			expect(output).toContain("@railly");
			expect(output).toContain("opus");
			expect(output).toContain("12k/200k (6%)");
			expect(output).toContain("♥ 1m");
			expect(output.indexOf("12k/200k (6%)")).toBeLessThan(
				output.indexOf("♥ 1m"),
			);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("renders a restart notice on the status row when provided", async () => {
		const { app, getOutput } = renderStatusBar({
			status: "connected",
			info: {
				model: "opus",
				effort: "high",
			},
			notice: "Restart required",
		});

		try {
			await flushUpdates();
			const output = getOutput();
			expect(output).toContain("connected");
			expect(output).toContain("opus");
			expect(output).toContain("high");
			expect(output).toContain("Restart required");
			expect(output.indexOf("high")).toBeLessThan(
				output.indexOf("Restart required"),
			);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});
});
