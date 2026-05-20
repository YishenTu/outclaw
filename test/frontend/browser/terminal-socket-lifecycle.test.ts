import { describe, expect, test } from "bun:test";
import { createTerminalSocketLifecycle } from "../../../src/frontend/browser/components/right-panel/terminal/terminal-socket-lifecycle.ts";

class FakeTerminalSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSED = 3;

	closed = false;
	onclose: ((event?: unknown) => void) | null = null;
	onerror: ((event?: unknown) => void) | null = null;
	onmessage: ((message: { data: unknown }) => void) | null = null;
	onopen: ((event?: unknown) => void) | null = null;
	readyState = FakeTerminalSocket.CONNECTING;
	readonly sent: string[] = [];

	close() {
		this.closed = true;
		this.readyState = FakeTerminalSocket.CLOSED;
		this.onclose?.();
	}

	send(data: string) {
		this.sent.push(data);
	}
}

describe("terminal socket lifecycle", () => {
	test("reconnects after close and ignores stale socket events", () => {
		const sockets: FakeTerminalSocket[] = [];
		const scheduled: Array<() => void> = [];
		const received: string[] = [];
		const currentSockets: Array<FakeTerminalSocket | null> = [];
		let connectedCount = 0;
		let disconnectedCount = 0;

		const lifecycle = createTerminalSocketLifecycle<FakeTerminalSocket, number>(
			{
				clearRetry: (timer) => {
					scheduled[timer] = () => {};
				},
				isSocketOpen: (socket) => socket.readyState === FakeTerminalSocket.OPEN,
				onConnected: () => {
					connectedCount += 1;
				},
				onData: (data) => {
					received.push(data);
				},
				onDisconnected: () => {
					disconnectedCount += 1;
				},
				openSocket: () => {
					const socket = new FakeTerminalSocket();
					sockets.push(socket);
					return socket;
				},
				retryDelayMs: 25,
				scheduleRetry: (callback, delayMs) => {
					expect(delayMs).toBe(25);
					scheduled.push(callback);
					return scheduled.length - 1;
				},
				setCurrentSocket: (socket) => {
					currentSockets.push(socket);
				},
			},
		);

		lifecycle.start();
		const firstSocket = sockets[0];
		if (!firstSocket) {
			throw new Error("Expected first terminal socket");
		}
		expect(lifecycle.getSocket()).toBe(firstSocket);
		expect(currentSockets).toEqual([firstSocket]);
		expect(lifecycle.send("before-open")).toBe(false);
		firstSocket.readyState = FakeTerminalSocket.OPEN;
		firstSocket.onopen?.();
		expect(connectedCount).toBe(1);
		expect(lifecycle.send("pwd\r")).toBe(true);
		expect(firstSocket.sent).toEqual(["pwd\r"]);

		firstSocket.onmessage?.({ data: "shell output" });
		expect(received).toEqual(["shell output"]);

		firstSocket.close();
		expect(lifecycle.getSocket()).toBeNull();
		expect(currentSockets.at(-1)).toBeNull();
		expect(disconnectedCount).toBe(1);
		expect(scheduled).toHaveLength(1);
		expect(lifecycle.send("lost\r")).toBe(false);

		scheduled[0]?.();
		const secondSocket = sockets[1];
		if (!secondSocket) {
			throw new Error("Expected reconnect terminal socket");
		}
		expect(lifecycle.getSocket()).toBe(secondSocket);
		expect(currentSockets.at(-1)).toBe(secondSocket);

		firstSocket.onmessage?.({ data: "stale output" });
		firstSocket.onclose?.();
		expect(received).toEqual(["shell output"]);
		expect(scheduled).toHaveLength(1);

		secondSocket.readyState = FakeTerminalSocket.OPEN;
		secondSocket.onopen?.();
		expect(connectedCount).toBe(2);
	});

	test("stop closes the current socket without scheduling reconnect", () => {
		const sockets: FakeTerminalSocket[] = [];
		const clearedTimers: number[] = [];
		const scheduled: Array<() => void> = [];
		let disconnectedCount = 0;

		const lifecycle = createTerminalSocketLifecycle<FakeTerminalSocket, number>(
			{
				clearRetry: (timer) => {
					clearedTimers.push(timer);
				},
				isSocketOpen: (socket) => socket.readyState === FakeTerminalSocket.OPEN,
				onConnected: () => {},
				onData: () => {},
				onDisconnected: () => {
					disconnectedCount += 1;
				},
				openSocket: () => {
					const socket = new FakeTerminalSocket();
					sockets.push(socket);
					return socket;
				},
				scheduleRetry: (callback) => {
					scheduled.push(callback);
					return 7;
				},
				setCurrentSocket: () => {},
			},
		);

		lifecycle.start();
		sockets[0]?.onclose?.();
		lifecycle.stop();

		expect(clearedTimers).toEqual([7]);
		expect(sockets[0]?.closed).toBe(false);
		expect(lifecycle.getSocket()).toBeNull();
		expect(disconnectedCount).toBe(1);
	});
});
