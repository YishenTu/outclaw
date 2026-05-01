import { describe, expect, test } from "bun:test";
import type { ServerEvent } from "../../../src/common/protocol.ts";
import { createBrowserSocketLifecycle } from "../../../src/frontend/browser/events/browser-socket-lifecycle.ts";

class FakeBrowserSocket {
	closed = false;
	onclose: ((event?: unknown) => void) | null = null;
	onerror: ((event?: unknown) => void) | null = null;
	onmessage: ((message: { data: unknown }) => void) | null = null;
	onopen: ((event?: unknown) => void) | null = null;

	close() {
		this.closed = true;
	}
}

describe("browser socket lifecycle", () => {
	test("connects, reconnects, and ignores stale socket events", () => {
		const sockets: FakeBrowserSocket[] = [];
		const statuses: string[] = [];
		const events: ServerEvent[] = [];
		const scheduled: Array<() => void> = [];
		const socketRef: { current: FakeBrowserSocket | null } = { current: null };
		let connectedCount = 0;

		const lifecycle = createBrowserSocketLifecycle<FakeBrowserSocket, number>({
			applyEvent: (event) => events.push(event),
			clearRetry: (timer) => {
				scheduled[timer] = () => {};
			},
			openSocket: () => {
				const ws = new FakeBrowserSocket();
				sockets.push(ws);
				return { ready: Promise.resolve(), ws };
			},
			onConnected: () => {
				connectedCount += 1;
			},
			parseMessage: (data) => JSON.parse(data) as ServerEvent,
			retryDelayMs: 25,
			scheduleRetry: (callback, delayMs) => {
				expect(delayMs).toBe(25);
				scheduled.push(callback);
				return scheduled.length - 1;
			},
			setConnectionStatus: (status) => statuses.push(status),
			setCurrentSocket: (socket) => {
				socketRef.current = socket;
			},
			setRuntimeError: (error) => statuses.push(`error:${error}`),
		});

		lifecycle.start();
		expect(socketRef.current).toBe(sockets[0] ?? null);
		expect(statuses).toEqual(["connecting"]);

		sockets[0]?.onopen?.();
		expect(statuses).toEqual(["connecting", "connected", "error:null"]);
		expect(connectedCount).toBe(1);

		sockets[0]?.onmessage?.({
			data: JSON.stringify({ type: "ask_response", text: "ok" }),
		});
		expect(events).toEqual([{ type: "ask_response", text: "ok" }]);

		sockets[0]?.onclose?.();
		expect(socketRef.current).toBeNull();
		expect(statuses.at(-1)).toBe("disconnected");
		expect(scheduled).toHaveLength(1);

		scheduled[0]?.();
		expect(socketRef.current).toBe(sockets[1] ?? null);
		expect(lifecycle.getSocket()).toBe(sockets[1] ?? null);

		sockets[0]?.onmessage?.({
			data: JSON.stringify({ type: "ask_response", text: "stale" }),
		});
		sockets[0]?.onclose?.();
		expect(events).toEqual([{ type: "ask_response", text: "ok" }]);
		expect(scheduled).toHaveLength(1);
	});

	test("stop cancels retry and closes the current socket", () => {
		const sockets: FakeBrowserSocket[] = [];
		const clearedTimers: number[] = [];
		const socketRef: { current: FakeBrowserSocket | null } = { current: null };

		const lifecycle = createBrowserSocketLifecycle<FakeBrowserSocket, number>({
			applyEvent: () => {},
			clearRetry: (timer) => clearedTimers.push(timer),
			openSocket: () => {
				const ws = new FakeBrowserSocket();
				sockets.push(ws);
				return { ready: Promise.resolve(), ws };
			},
			onConnected: () => {},
			parseMessage: (data) => JSON.parse(data) as ServerEvent,
			scheduleRetry: () => 7,
			setConnectionStatus: () => {},
			setCurrentSocket: (socket) => {
				socketRef.current = socket;
			},
			setRuntimeError: () => {},
		});

		lifecycle.start();
		sockets[0]?.onclose?.();
		lifecycle.stop();

		expect(clearedTimers).toEqual([7]);
		expect(socketRef.current).toBeNull();
		expect(sockets[0]?.closed).toBe(false);
		expect(lifecycle.getSocket()).toBeNull();
	});
});
