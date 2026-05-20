import { describe, expect, mock, test } from "bun:test";
import { BrowserTerminalManager } from "../../../../src/runtime/browser/terminal/manager.ts";

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

function createClient(ownerId = "browser-1") {
	const sent: unknown[] = [];
	return {
		client: {
			data: {
				clientType: "browser" as const,
				cookieClientId: ownerId,
			},
			send: mock((message: string) => {
				sent.push(JSON.parse(message));
			}),
		},
		sent,
	};
}

describe("BrowserTerminalManager", () => {
	test("reattaches a browser-owned terminal and replays buffered output", () => {
		const terminalWrite = mock(() => {});
		const terminalResize = mock(() => {});
		const terminalClose = mock(() => {});
		let onData:
			| ((terminal: Bun.Terminal, data: Uint8Array) => void)
			| undefined;
		const procKill = mock(() => {});
		const fallbackScheduler = createFallbackScheduler();
		const manager = new BrowserTerminalManager(
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
					kill: procKill,
				})) as unknown as typeof Bun.spawn,
			},
			{
				scheduleStartupInputFallback: fallbackScheduler.schedule,
			},
		);
		const first = createClient();

		manager.create({
			client: first.client,
			cols: 100,
			cwd: "/tmp/agent",
			name: "Terminal",
			rows: 32,
			scopeId: "agent-a",
			target: { kind: "agent", agentId: "agent-a" },
			terminalId: "terminal-1",
		});
		onData?.({} as Bun.Terminal, new TextEncoder().encode("prompt> "));
		manager.input("browser-1", "terminal-1", "echo hi\r");
		manager.detachClient(first.client);
		onData?.({} as Bun.Terminal, new TextEncoder().encode("during detach\r\n"));

		const second = createClient();
		manager.attach({
			client: second.client,
			cols: 120,
			rows: 40,
			terminalId: "terminal-1",
		});

		expect(terminalWrite).toHaveBeenCalledWith("echo hi\r");
		expect(terminalResize).toHaveBeenCalledWith(100, 32);
		expect(terminalResize).toHaveBeenCalledWith(120, 40);
		expect(procKill).toHaveBeenCalledWith("SIGWINCH");
		expect(fallbackScheduler.cancelled()).toBe(true);
		expect(second.sent).toContainEqual({
			type: "terminal_attached",
			bufferedOutput: "prompt> during detach\r\n",
			terminalId: "terminal-1",
		});
	});

	test("keeps terminal sessions scoped by browser client id", () => {
		const manager = new BrowserTerminalManager({
			createTerminal: mock(() => {
				return {
					close: mock(() => {}),
					resize: mock(() => {}),
					write: mock(() => {}),
				} as unknown as Bun.Terminal;
			}),
			spawn: mock(() => ({
				exited: new Promise<number>(() => {}),
				kill: mock(() => {}),
			})) as unknown as typeof Bun.spawn,
		});
		const owner = createClient("browser-1");
		const other = createClient("browser-2");

		manager.create({
			client: owner.client,
			cwd: "/tmp/agent",
			name: "Terminal",
			scopeId: "agent-a",
			target: { kind: "agent", agentId: "agent-a" },
			terminalId: "terminal-1",
		});
		manager.attach({
			client: other.client,
			terminalId: "terminal-1",
		});

		expect(other.sent).toContainEqual({
			type: "terminal_error",
			message: "Terminal session is not available",
			terminalId: "terminal-1",
		});
	});
});
