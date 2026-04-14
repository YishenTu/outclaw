import { afterEach, describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { TuiApp } from "../../../src/frontend/tui/app.tsx";

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readyState = FakeWebSocket.CONNECTING;
	readonly sent: string[] = [];
	onclose: ((event?: unknown) => void) | null = null;
	onerror: ((event?: unknown) => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onopen: ((event?: unknown) => void) | null = null;
	private listeners = new Map<string, Set<(event?: unknown) => void>>();

	constructor(readonly url: string) {
		FakeWebSocket.instances.push(this);
	}

	static reset() {
		FakeWebSocket.instances.length = 0;
	}

	addEventListener(type: string, handler: (event?: unknown) => void) {
		let handlers = this.listeners.get(type);
		if (!handlers) {
			handlers = new Set();
			this.listeners.set(type, handlers);
		}
		handlers.add(handler);
	}

	removeEventListener(type: string, handler: (event?: unknown) => void) {
		this.listeners.get(type)?.delete(handler);
	}

	send(data: string) {
		this.sent.push(data);
	}

	close() {
		this.readyState = FakeWebSocket.CLOSED;
		this.dispatch("close");
	}

	dispatch(type: "open" | "error" | "close" | "message", event?: unknown) {
		if (type === "open") {
			this.readyState = FakeWebSocket.OPEN;
		}
		if (type === "close") {
			this.readyState = FakeWebSocket.CLOSED;
		}
		for (const handler of this.listeners.get(type) ?? []) {
			handler(event);
		}
		if (type === "message") {
			this.onmessage?.(event as { data: string });
			return;
		}
		if (type === "open") {
			this.onopen?.(event);
			return;
		}
		const propertyHandler =
			type === "close" ? this.onclose : type === "error" ? this.onerror : null;
		propertyHandler?.(event);
	}
}

function createOutputStream(rows = 24) {
	const stream = new PassThrough() as PassThrough &
		NodeJS.WriteStream & {
			columns: number;
			isTTY: boolean;
			rows: number;
		};
	stream.columns = 80;
	stream.isTTY = false;
	stream.rows = rows;
	return stream;
}

async function flushUpdates() {
	for (let index = 0; index < 5; index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

async function renderApp({ rows = 24 }: { rows?: number } = {}) {
	const stdout = createOutputStream(rows);
	const stderr = createOutputStream(rows);
	const stdin = new PassThrough() as PassThrough & {
		isTTY: boolean;
	};
	stdin.isTTY = false;
	const frames: string[] = [];
	stdout.on("data", (chunk) => {
		frames.push(chunk.toString());
	});

	const app = render(<TuiApp url="ws://localhost:4100" />, {
		debug: true,
		exitOnCtrlC: false,
		patchConsole: false,
		stderr,
		stdin: stdin as unknown as NodeJS.ReadStream & { isTTY: boolean },
		stdout,
	});

	await flushUpdates();

	const socket = FakeWebSocket.instances[0] as FakeWebSocket;
	socket.dispatch("open");
	await flushUpdates();

	return {
		app,
		socket,
		stdin,
		getOutput: () => frames.at(-1) ?? "",
	};
}

async function typeText(stdin: PassThrough, value: string) {
	stdin.write(value);
	await flushUpdates();
}

async function pressEnter(stdin: PassThrough) {
	stdin.write("\r");
	await flushUpdates();
}

async function pressEscape(stdin: PassThrough) {
	stdin.write("\u001B");
	await flushUpdates();
}

async function pressUp(stdin: PassThrough) {
	stdin.write("\u001B[A");
	await flushUpdates();
}

async function pressDown(stdin: PassThrough) {
	stdin.write("\u001B[B");
	await flushUpdates();
}

async function pressTab(stdin: PassThrough) {
	stdin.write("\t");
	await flushUpdates();
}

async function waitFor(predicate: () => boolean, label: string) {
	for (let index = 0; index < 100; index += 1) {
		if (predicate()) {
			return;
		}
		await flushUpdates();
	}
	throw new Error(`Timed out waiting for ${label}`);
}

describe("TuiApp", () => {
	const realWebSocket = globalThis.WebSocket;

	afterEach(() => {
		globalThis.WebSocket = realWebSocket;
		FakeWebSocket.reset();
	});

	test("first Enter on a partial slash command only autocompletes; second Enter sends it", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const { app, socket, stdin } = await renderApp();

		try {
			await typeText(stdin, "/s");
			expect(socket.sent).toEqual(['{"type":"request_skills"}']);

			await pressEnter(stdin);
			expect(socket.sent).toEqual(['{"type":"request_skills"}']);

			await pressEnter(stdin);
			expect(socket.sent).toEqual([
				'{"type":"request_skills"}',
				'{"type":"command","command":"/session"}',
			]);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("first Enter on an exact slash command still does not send immediately", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const { app, socket, stdin } = await renderApp();

		try {
			await typeText(stdin, "/status");
			expect(socket.sent).toEqual(['{"type":"request_skills"}']);

			await pressEnter(stdin);
			expect(socket.sent).toEqual(['{"type":"request_skills"}']);

			await pressEnter(stdin);
			expect(socket.sent).toEqual([
				'{"type":"request_skills"}',
				'{"type":"command","command":"/status"}',
			]);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("autocomplete submits /compact as a prompt without trailing whitespace", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const { app, socket, stdin, getOutput } = await renderApp();

		try {
			await typeText(stdin, "/co");
			expect(socket.sent).toEqual(['{"type":"request_skills"}']);

			await pressEnter(stdin);
			expect(socket.sent).toEqual(['{"type":"request_skills"}']);

			await pressEnter(stdin);
			expect(socket.sent).toEqual([
				'{"type":"request_skills"}',
				'{"type":"prompt","prompt":"/compact"}',
			]);
			expect(
				socket.sent.some((message) => message.includes('"type":"command"')),
			).toBe(false);
			expect(getOutput()).toContain("Compacting...");
			expect(getOutput()).not.toContain("Thinking...");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("submits prompts, resets the composer, and uses escape to stop active work", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const { app, socket, stdin } = await renderApp();

		try {
			await typeText(stdin, "hello");
			await pressEnter(stdin);
			expect(socket.sent).toContain('{"type":"prompt","prompt":"hello"}');

			socket.dispatch("message", {
				data: JSON.stringify({
					type: "done",
					sessionId: "sdk-1",
					durationMs: 1,
				}),
			});
			await flushUpdates();

			await typeText(stdin, "world");
			await pressEnter(stdin);
			expect(socket.sent).toContain('{"type":"prompt","prompt":"world"}');

			await pressEscape(stdin);
			expect(socket.sent).toContain('{"type":"command","command":"/stop"}');
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("ignores blank submits without sending a prompt", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const { app, socket, stdin } = await renderApp();

		try {
			await typeText(stdin, "   ");
			await pressEnter(stdin);
			expect(socket.sent).toEqual([]);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("command completion navigation wraps with up to the last command", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const { app, socket, stdin } = await renderApp();

		try {
			await typeText(stdin, "/s");
			expect(socket.sent).toEqual(['{"type":"request_skills"}']);

			await pressUp(stdin);
			await pressEnter(stdin);
			await pressEnter(stdin);
			expect(socket.sent).toContain('{"type":"command","command":"/stop"}');
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("command completion navigation advances with down to the next command", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const { app, socket, stdin } = await renderApp();

		try {
			await typeText(stdin, "/s");
			expect(socket.sent).toEqual(['{"type":"request_skills"}']);

			await pressDown(stdin);
			await pressEnter(stdin);
			await pressEnter(stdin);
			expect(socket.sent).toContain('{"type":"command","command":"/status"}');
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("escape dismisses command completion so Enter submits the command directly", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const { app, socket, stdin } = await renderApp();

		try {
			await typeText(stdin, "/status");
			expect(socket.sent).toEqual(['{"type":"request_skills"}']);

			await pressEscape(stdin);
			await pressEnter(stdin);
			expect(socket.sent).toEqual([
				'{"type":"request_skills"}',
				'{"type":"command","command":"/status"}',
			]);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("tab is ignored in the composer and escape clears collapsed pastes", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const { app, socket, stdin } = await renderApp();

		try {
			await typeText(stdin, "x");
			await pressTab(stdin);
			await pressEnter(stdin);
			expect(socket.sent).toContain('{"type":"prompt","prompt":"x"}');

			socket.dispatch("message", {
				data: JSON.stringify({
					type: "done",
					sessionId: "sdk-1",
					durationMs: 1,
				}),
			});
			await flushUpdates();

			await typeText(stdin, "line 1\nline 2\nline 3\nline 4");
			await pressEscape(stdin);
			await typeText(stdin, "y");
			await pressEnter(stdin);
			expect(socket.sent).toContain('{"type":"prompt","prompt":"y"}');
			expect(
				socket.sent.some((message) =>
					message.includes("line 1\nline 2\nline 3"),
				),
			).toBe(false);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("session menu actions send session commands through the runtime", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const { app, socket, stdin } = await renderApp();

		try {
			socket.dispatch("message", {
				data: JSON.stringify({
					type: "session_menu",
					activeSessionId: "sdk-active",
					sessions: [
						{
							sdkSessionId: "sdk-active",
							title: "Active session",
							model: "opus",
							lastActive: 10,
						},
						{
							sdkSessionId: "sdk-other",
							title: "Other session",
							model: "sonnet",
							lastActive: 5,
						},
					],
				}),
			});
			await flushUpdates();

			await pressEnter(stdin);
			expect(socket.sent).toContain(
				'{"type":"command","command":"/session sdk-active"}',
			);

			socket.dispatch("message", {
				data: JSON.stringify({
					type: "session_menu",
					activeSessionId: "sdk-active",
					sessions: [
						{
							sdkSessionId: "sdk-active",
							title: "Active session",
							model: "opus",
							lastActive: 10,
						},
						{
							sdkSessionId: "sdk-other",
							title: "Other session",
							model: "sonnet",
							lastActive: 5,
						},
					],
				}),
			});
			await flushUpdates();

			await typeText(stdin, "d");
			expect(socket.sent).toContain(
				'{"type":"command","command":"/session delete sdk-active"}',
			);

			socket.dispatch("message", {
				data: JSON.stringify({
					type: "session_menu",
					activeSessionId: "sdk-active",
					sessions: [
						{
							sdkSessionId: "sdk-active",
							title: "Active session",
							model: "opus",
							lastActive: 10,
						},
						{
							sdkSessionId: "sdk-other",
							title: "Other session",
							model: "sonnet",
							lastActive: 5,
						},
					],
				}),
			});
			await flushUpdates();

			await typeText(stdin, "r");
			await pressEnter(stdin);
			await pressEnter(stdin);
			expect(socket.sent).toContain(
				'{"type":"command","command":"/session rename sdk-active Active session"}',
			);

			socket.dispatch("message", {
				data: JSON.stringify({
					type: "session_menu",
					activeSessionId: "sdk-active",
					sessions: [
						{
							sdkSessionId: "sdk-active",
							title: "Active session",
							model: "opus",
							lastActive: 10,
						},
						{
							sdkSessionId: "sdk-other",
							title: "Other session",
							model: "sonnet",
							lastActive: 5,
						},
					],
				}),
			});
			await flushUpdates();

			await pressUp(stdin);
			await pressEnter(stdin);
			expect(socket.sent).toContain(
				'{"type":"command","command":"/session sdk-other"}',
			);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("agent menu actions send agent switch commands through the runtime", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const { app, socket, stdin } = await renderApp();

		try {
			socket.dispatch("message", {
				data: JSON.stringify({
					type: "agent_menu",
					activeAgentId: "agent-railly",
					activeAgentName: "railly",
					agents: [
						{ agentId: "agent-mimi", name: "mimi" },
						{ agentId: "agent-railly", name: "railly" },
					],
				}),
			});
			await flushUpdates();

			await pressEnter(stdin);
			expect(socket.sent).toContain(
				'{"type":"command","command":"/agent mimi"}',
			);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("slash exit closes the runtime session without sending a command", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const { app, socket, stdin } = await renderApp();

		try {
			await typeText(stdin, "/exit");
			await pressEnter(stdin);
			await pressEnter(stdin);
			await waitFor(
				() => socket.readyState === FakeWebSocket.CLOSED,
				"socket close after /exit",
			);
			expect(socket.sent).toEqual(['{"type":"request_skills"}']);
		} finally {
			app.cleanup();
		}
	});
});
