import { describe, expect, mock, test } from "bun:test";
import { TerminalRelay } from "../../../src/runtime/browser/terminal-relay.ts";

describe("TerminalRelay", () => {
	function createFallbackScheduler() {
		let fallback: (() => void) | undefined;
		let cancelled = false;

		return {
			cancelled: () => cancelled,
			runFallback: () => {
				fallback?.();
			},
			schedule: (callback: () => void, delayMs: number) => {
				expect(delayMs).toBe(300);
				fallback = callback;
				return () => {
					cancelled = true;
				};
			},
		};
	}

	test("writes terminal input and handles resize messages", () => {
		const terminalWrite = mock(() => {});
		const terminalResize = mock(() => {});
		const terminalClose = mock(() => {});
		let onData:
			| ((terminal: Bun.Terminal, data: Uint8Array) => void)
			| undefined;
		const procKill = mock(() => {});
		let exitedResolver: (() => void) | undefined;

		const fallbackScheduler = createFallbackScheduler();
		const relay = new TerminalRelay(
			{
				createTerminal: mock((options) => {
					onData = options.data;
					return {
						close: terminalClose,
						resize: terminalResize,
						write: terminalWrite,
					} as unknown as Bun.Terminal;
				}),
				spawn: mock(() => ({
					exited: new Promise<number>((resolve) => {
						exitedResolver = () => resolve(0);
					}),
					kill: procKill,
				})) as unknown as typeof Bun.spawn,
			},
			{
				scheduleStartupInputFallback: fallbackScheduler.schedule,
			},
		);

		const sent: string[] = [];
		const ws = {
			data: {
				socketType: "terminal" as const,
				terminalCwd: "/tmp/agent",
			},
			close: mock(() => {}),
			readyState: WebSocket.OPEN,
			send: mock((message: string) => {
				sent.push(message);
			}),
		} as unknown as Parameters<TerminalRelay["handleOpen"]>[0];

		relay.handleOpen(ws);
		relay.handleMessage(ws, "echo hi");
		expect(terminalWrite).not.toHaveBeenCalled();

		relay.handleMessage(
			ws,
			JSON.stringify({
				type: "resize",
				cols: 120,
				rows: 40,
			}),
		);

		onData?.({} as Bun.Terminal, new TextEncoder().encode("prompt> "));
		relay.handleMessage(ws, "pwd");
		exitedResolver?.();

		expect(terminalWrite).toHaveBeenCalledWith("echo hi");
		expect(terminalWrite).toHaveBeenCalledWith("pwd");
		expect(terminalResize).toHaveBeenCalledWith(120, 40);
		expect(procKill).toHaveBeenCalledWith("SIGWINCH");
		expect(sent).toContain("prompt> ");
		expect(fallbackScheduler.cancelled()).toBe(true);
	});

	test("queues buffered terminal input until initial shell output", () => {
		const terminalWrite = mock(() => {});
		const terminalResize = mock(() => {});
		const terminalClose = mock(() => {});
		let onData:
			| ((terminal: Bun.Terminal, data: Uint8Array) => void)
			| undefined;

		const fallbackScheduler = createFallbackScheduler();
		const relay = new TerminalRelay(
			{
				createTerminal: mock((options) => {
					onData = options.data;
					return {
						close: terminalClose,
						resize: terminalResize,
						write: terminalWrite,
					} as unknown as Bun.Terminal;
				}),
				spawn: mock(() => ({
					exited: new Promise<number>(() => {}),
					kill: mock(() => {}),
				})) as unknown as typeof Bun.spawn,
			},
			{
				scheduleStartupInputFallback: fallbackScheduler.schedule,
			},
		);

		const sent: string[] = [];
		const ws = {
			data: {
				socketType: "terminal" as const,
				terminalCwd: "/tmp/agent",
			},
			close: mock(() => {}),
			readyState: WebSocket.OPEN,
			send: mock((message: string) => {
				sent.push(message);
			}),
		} as unknown as Parameters<TerminalRelay["handleOpen"]>[0];

		relay.handleOpen(ws);
		relay.handleMessage(ws, Buffer.from("echo hi\r"));
		relay.handleMessage(ws, "pwd\r");

		expect(terminalWrite).not.toHaveBeenCalled();

		onData?.({} as Bun.Terminal, new TextEncoder().encode("prompt> "));

		expect(sent).toEqual(["prompt> "]);
		expect(terminalWrite).toHaveBeenNthCalledWith(1, "echo hi\r");
		expect(terminalWrite).toHaveBeenNthCalledWith(2, "pwd\r");
		expect(fallbackScheduler.cancelled()).toBe(true);

		relay.handleMessage(ws, "date\r");
		expect(terminalWrite).toHaveBeenNthCalledWith(3, "date\r");
	});

	test("flushes queued input after the startup fallback when no shell output arrives", () => {
		const terminalWrite = mock(() => {});
		const terminalResize = mock(() => {});
		const terminalClose = mock(() => {});
		const fallbackScheduler = createFallbackScheduler();

		const relay = new TerminalRelay(
			{
				createTerminal: mock(() => {
					return {
						close: terminalClose,
						resize: terminalResize,
						write: terminalWrite,
					} as unknown as Bun.Terminal;
				}),
				spawn: mock(() => ({
					exited: new Promise<number>(() => {}),
					kill: mock(() => {}),
				})) as unknown as typeof Bun.spawn,
			},
			{
				scheduleStartupInputFallback: fallbackScheduler.schedule,
			},
		);

		const ws = {
			data: {
				socketType: "terminal" as const,
				terminalCwd: "/tmp/agent",
			},
			close: mock(() => {}),
			readyState: WebSocket.OPEN,
			send: mock(() => {}),
		} as unknown as Parameters<TerminalRelay["handleOpen"]>[0];

		relay.handleOpen(ws);
		relay.handleMessage(ws, "echo hi\r");
		expect(terminalWrite).not.toHaveBeenCalled();

		fallbackScheduler.runFallback();

		expect(terminalWrite).toHaveBeenCalledWith("echo hi\r");
		expect(fallbackScheduler.cancelled()).toBe(true);
	});
});
