import { describe, expect, mock, test } from "bun:test";
import { TerminalRelay } from "../../../src/runtime/browser/terminal-relay.ts";

describe("TerminalRelay", () => {
	test("writes terminal input and handles resize messages", () => {
		const terminalWrite = mock(() => {});
		const terminalResize = mock(() => {});
		const terminalClose = mock(() => {});
		let onData:
			| ((terminal: Bun.Terminal, data: Uint8Array) => void)
			| undefined;
		const procKill = mock(() => {});
		let exitedResolver: (() => void) | undefined;

		const relay = new TerminalRelay({
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
		});

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
		relay.handleMessage(
			ws,
			JSON.stringify({
				type: "resize",
				cols: 120,
				rows: 40,
			}),
		);

		onData?.({} as Bun.Terminal, new TextEncoder().encode("prompt> "));
		exitedResolver?.();

		expect(terminalWrite).toHaveBeenCalledWith("echo hi");
		expect(terminalResize).toHaveBeenCalledWith(120, 40);
		expect(procKill).toHaveBeenCalledWith("SIGWINCH");
		expect(sent).toContain("Connected to /tmp/agent\r\n");
		expect(sent).toContain("prompt> ");
	});
});
