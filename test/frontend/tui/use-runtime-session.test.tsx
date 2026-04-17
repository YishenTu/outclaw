import { afterEach, describe, expect, test, vi } from "bun:test";
import { PassThrough } from "node:stream";
import { render, Text } from "ink";
import { useLayoutEffect } from "react";
import type { SkillInfo } from "../../../src/common/protocol.ts";
import { useRuntimeSession } from "../../../src/frontend/tui/use-runtime-session.ts";

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readyState = FakeWebSocket.CONNECTING;
	readonly sent: string[] = [];
	closeCalls = 0;
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
		this.closeCalls += 1;
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

interface Snapshot {
	agentMenuData: ReturnType<typeof useRuntimeSession>["agentMenuData"];
	dismissSessionMenu: () => void;
	menuData: ReturnType<typeof useRuntimeSession>["menuData"];
	requestSkills: () => boolean;
	runCommand: (command: string) => boolean;
	runPrompt: (prompt: string) => boolean;
	runtimeInfo: ReturnType<typeof useRuntimeSession>["runtimeInfo"];
	skills: SkillInfo[];
	status: string;
	tuiState: ReturnType<typeof useRuntimeSession>["tuiState"];
}

function SessionObserver({
	onSnapshot,
	url,
}: {
	onSnapshot: (snapshot: Snapshot) => void;
	url: string;
}) {
	const session = useRuntimeSession(url);

	useLayoutEffect(() => {
		onSnapshot({
			agentMenuData: session.agentMenuData,
			dismissSessionMenu: session.dismissSessionMenu,
			menuData: session.menuData,
			requestSkills: session.requestSkills,
			runCommand: session.runCommand,
			runPrompt: session.runPrompt,
			runtimeInfo: session.runtimeInfo,
			skills: session.skills,
			status: session.status,
			tuiState: session.tuiState,
		});
	}, [
		onSnapshot,
		session.dismissSessionMenu,
		session.agentMenuData,
		session.menuData,
		session.requestSkills,
		session.runCommand,
		session.runPrompt,
		session.runtimeInfo,
		session.skills,
		session.status,
		session.tuiState,
	]);

	return <Text>{session.status}</Text>;
}

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

async function waitFor(predicate: () => boolean, label: string) {
	for (let index = 0; index < 100; index += 1) {
		if (predicate()) {
			return;
		}
		await flushUpdates();
	}
	throw new Error(`Timed out waiting for ${label}`);
}

describe("useRuntimeSession", () => {
	const realWebSocket = globalThis.WebSocket;

	afterEach(() => {
		globalThis.WebSocket = realWebSocket;
		FakeWebSocket.reset();
		vi.useRealTimers();
	});

	test("clears stale skills on disconnect and allows a fresh request after reconnect", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		let latest: Snapshot | undefined;
		const stdout = createOutputStream();
		const stderr = createOutputStream();
		const stdin = new PassThrough() as unknown as NodeJS.ReadStream & {
			isTTY: boolean;
		};
		stdin.isTTY = false;

		const app = render(
			<SessionObserver
				url="ws://localhost:4100"
				onSnapshot={(snapshot) => {
					latest = snapshot;
				}}
			/>,
			{
				exitOnCtrlC: false,
				patchConsole: false,
				stderr,
				stdin,
				stdout,
			},
		);

		try {
			await waitFor(
				() => FakeWebSocket.instances.length === 1,
				"initial socket",
			);
			const firstSocket = FakeWebSocket.instances[0] as FakeWebSocket;
			firstSocket.dispatch("open");
			await waitFor(() => latest?.status === "connected", "connected status");

			latest?.requestSkills();
			expect(firstSocket.sent).toContain('{"type":"request_skills"}');
			expect(latest?.requestSkills()).toBe(false);

			firstSocket.dispatch("message", {
				data: JSON.stringify({
					type: "skills_update",
					skills: [{ name: "commit", description: "Create a commit" }],
				}),
			});
			await waitFor(
				() => latest?.skills[0]?.name === "commit",
				"skills update on first socket",
			);

			firstSocket.dispatch("message", {
				data: JSON.stringify({ type: "compacting_started" }),
			});
			await waitFor(
				() => latest?.tuiState.compacting === true,
				"compacting state before disconnect",
			);

			vi.useFakeTimers();
			firstSocket.dispatch("close");
			await waitFor(
				() => latest?.status === "disconnected",
				"disconnected status",
			);
			expect(latest?.skills).toEqual([]);
			expect(latest?.tuiState.compacting).toBe(false);

			vi.advanceTimersByTime(3000);
			await waitFor(
				() => FakeWebSocket.instances.length === 2,
				"reconnect socket",
			);

			const secondSocket = FakeWebSocket.instances[1] as FakeWebSocket;
			secondSocket.dispatch("open");
			await waitFor(() => latest?.status === "connected", "reconnected status");

			latest?.requestSkills();
			expect(secondSocket.sent).toContain('{"type":"request_skills"}');
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("optimistically pushes prompts and tracks runtime info and session menu events", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		let latest: Snapshot | undefined;
		const stdout = createOutputStream();
		const stderr = createOutputStream();
		const stdin = new PassThrough() as unknown as NodeJS.ReadStream & {
			isTTY: boolean;
		};
		stdin.isTTY = false;

		const app = render(
			<SessionObserver
				url="ws://localhost:4100"
				onSnapshot={(snapshot) => {
					latest = snapshot;
				}}
			/>,
			{
				exitOnCtrlC: false,
				patchConsole: false,
				stderr,
				stdin,
				stdout,
			},
		);

		try {
			await waitFor(
				() => FakeWebSocket.instances.length === 1,
				"initial socket",
			);
			const socket = FakeWebSocket.instances[0] as FakeWebSocket;
			socket.dispatch("open");
			await waitFor(() => latest?.status === "connected", "connected status");

			expect(latest?.runPrompt("hello from tui")).toBe(true);
			expect(socket.sent).toContain(
				'{"type":"prompt","prompt":"hello from tui"}',
			);
			await waitFor(
				() =>
					latest?.tuiState.running === true &&
					latest?.tuiState.messages.at(-1)?.text === "hello from tui",
				"optimistic prompt state",
			);

			socket.dispatch("message", {
				data: JSON.stringify({
					type: "runtime_status",
					agentName: "railly",
					model: "sonnet",
					effort: "think",
					notice: { kind: "restart_required" },
					usage: { contextTokens: 1200, contextWindow: 200000 },
					nextHeartbeatAt: 12345,
					heartbeatDeferred: true,
				}),
			});
			await waitFor(
				() =>
					latest?.runtimeInfo.agentName === "railly" &&
					latest?.runtimeInfo.model === "sonnet" &&
					latest?.runtimeInfo.effort === "think" &&
					latest?.runtimeInfo.notice === "Restart required" &&
					latest?.runtimeInfo.contextTokens === 1200 &&
					latest?.runtimeInfo.nextHeartbeatAt === 12345 &&
					latest?.runtimeInfo.heartbeatDeferred === true,
				"runtime status info",
			);

			socket.dispatch("message", {
				data: JSON.stringify({
					type: "runtime_status",
					model: "sonnet",
					effort: "think",
				}),
			});
			await waitFor(
				() => latest?.runtimeInfo.notice === undefined,
				"runtime notice cleared",
			);

			socket.dispatch("message", {
				data: JSON.stringify({ type: "model_changed", model: "opus" }),
			});
			socket.dispatch("message", {
				data: JSON.stringify({ type: "effort_changed", effort: "ultrathink" }),
			});
			await waitFor(
				() =>
					latest?.runtimeInfo.model === "opus" &&
					latest?.runtimeInfo.effort === "ultrathink",
				"incremental runtime info",
			);

			socket.dispatch("message", {
				data: JSON.stringify({
					type: "agent_switched",
					agentId: "agent-railly",
					name: "railly",
				}),
			});
			await waitFor(
				() => latest?.runtimeInfo.agentName === "railly",
				"current agent info",
			);

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
			await waitFor(
				() => latest?.agentMenuData?.agents.length === 2,
				"agent menu data",
			);

			socket.dispatch("message", {
				data: JSON.stringify({
					type: "session_menu",
					activeSessionId: "sdk-active",
					sessions: [
						{
							sdkSessionId: "sdk-active",
							title: "Active",
							model: "opus",
							lastActive: 10,
						},
						{
							sdkSessionId: "sdk-other",
							title: "Other",
							model: "sonnet",
							lastActive: 5,
						},
					],
				}),
			});
			await waitFor(
				() => latest?.menuData?.sessions.length === 2,
				"session menu data",
			);

			socket.dispatch("message", {
				data: JSON.stringify({
					type: "session_renamed",
					sdkSessionId: "sdk-other",
					title: "Renamed other",
				}),
			});
			await waitFor(
				() => latest?.menuData?.sessions[1]?.title === "Renamed other",
				"renamed session menu entry",
			);

			socket.dispatch("message", {
				data: JSON.stringify({
					type: "session_deleted",
					sdkSessionId: "sdk-active",
				}),
			});
			await waitFor(
				() =>
					latest?.menuData?.activeSessionId === undefined &&
					latest?.menuData?.sessions.length === 1,
				"deleted active session",
			);

			latest?.dismissSessionMenu();
			await waitFor(() => latest?.menuData === null, "dismissed menu");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("surfaces disconnected and send errors for commands and prompts", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		let latest: Snapshot | undefined;
		const stdout = createOutputStream();
		const stderr = createOutputStream();
		const stdin = new PassThrough() as unknown as NodeJS.ReadStream & {
			isTTY: boolean;
		};
		stdin.isTTY = false;

		const app = render(
			<SessionObserver
				url="ws://localhost:4100"
				onSnapshot={(snapshot) => {
					latest = snapshot;
				}}
			/>,
			{
				exitOnCtrlC: false,
				patchConsole: false,
				stderr,
				stdin,
				stdout,
			},
		);

		try {
			await waitFor(
				() => FakeWebSocket.instances.length === 1,
				"initial socket",
			);
			expect(latest?.runCommand("/status")).toBe(false);
			expect(latest?.runPrompt("offline prompt")).toBe(false);
			await waitFor(
				() =>
					latest?.tuiState.messages.filter(
						(message) =>
							message.role === "error" &&
							message.text === "Runtime disconnected. Waiting to reconnect.",
					).length === 2,
				"disconnected local errors",
			);

			const socket = FakeWebSocket.instances[0] as FakeWebSocket;
			socket.dispatch("open");
			await waitFor(() => latest?.status === "connected", "connected status");

			socket.send = (_data: string) => {
				throw new Error("send failed");
			};
			expect(latest?.runCommand("/status")).toBe(false);
			expect(latest?.runPrompt("will fail")).toBe(false);
			expect(latest?.requestSkills()).toBe(false);
			await waitFor(
				() =>
					latest?.tuiState.messages.filter(
						(message) =>
							message.role === "error" && message.text === "send failed",
					).length === 2,
				"send failure local errors",
			);
			expect(
				latest?.tuiState.messages.some(
					(message) => message.role === "user" && message.text === "will fail",
				),
			).toBe(false);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("closes the socket on unmount and cancels reconnect timers", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
		vi.useFakeTimers();

		let latest: Snapshot | undefined;
		const stdout = createOutputStream();
		const stderr = createOutputStream();
		const stdin = new PassThrough() as unknown as NodeJS.ReadStream & {
			isTTY: boolean;
		};
		stdin.isTTY = false;

		const app = render(
			<SessionObserver
				url="ws://localhost:4100"
				onSnapshot={(snapshot) => {
					latest = snapshot;
				}}
			/>,
			{
				exitOnCtrlC: false,
				patchConsole: false,
				stderr,
				stdin,
				stdout,
			},
		);

		try {
			await waitFor(
				() => FakeWebSocket.instances.length === 1,
				"initial socket",
			);
			const socket = FakeWebSocket.instances[0] as FakeWebSocket;
			socket.dispatch("open");
			await waitFor(() => latest?.status === "connected", "connected status");

			app.unmount();
			await flushUpdates();
			expect(socket.closeCalls).toBe(1);

			socket.dispatch("close");
			vi.advanceTimersByTime(3000);
			await flushUpdates();
			expect(FakeWebSocket.instances).toHaveLength(1);
		} finally {
			app.cleanup();
		}
	});

	test("tracks running status for telegram-originated prompts", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		let latest: Snapshot | undefined;
		const stdout = createOutputStream();
		const stderr = createOutputStream();
		const stdin = new PassThrough() as unknown as NodeJS.ReadStream & {
			isTTY: boolean;
		};
		stdin.isTTY = false;

		const app = render(
			<SessionObserver
				url="ws://localhost:4100"
				onSnapshot={(snapshot) => {
					latest = snapshot;
				}}
			/>,
			{
				exitOnCtrlC: false,
				patchConsole: false,
				stderr,
				stdin,
				stdout,
			},
		);

		try {
			await waitFor(
				() => FakeWebSocket.instances.length === 1,
				"initial socket",
			);
			const socket = FakeWebSocket.instances[0] as FakeWebSocket;
			socket.dispatch("open");
			await waitFor(() => latest?.status === "connected", "connected status");

			socket.dispatch("message", {
				data: JSON.stringify({
					type: "user_prompt",
					prompt: "hello from telegram",
					source: "telegram",
				}),
			});
			socket.dispatch("message", {
				data: JSON.stringify({
					type: "runtime_status",
					model: "sonnet",
					effort: "think",
					running: true,
				}),
			});
			await waitFor(
				() =>
					latest?.tuiState.running === true &&
					latest?.tuiState.messages.at(-1)?.text ===
						"[telegram] hello from telegram",
				"telegram running state",
			);

			socket.dispatch("message", {
				data: JSON.stringify({
					type: "runtime_status",
					model: "sonnet",
					effort: "think",
					running: false,
				}),
			});
			await waitFor(
				() => latest?.tuiState.running === false,
				"telegram running cleared",
			);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("applies observed runtime transcript events while running", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		let latest: Snapshot | undefined;
		const stdout = createOutputStream();
		const stderr = createOutputStream();
		const stdin = new PassThrough() as unknown as NodeJS.ReadStream & {
			isTTY: boolean;
		};
		stdin.isTTY = false;

		const app = render(
			<SessionObserver
				url="ws://localhost:4100"
				onSnapshot={(snapshot) => {
					latest = snapshot;
				}}
			/>,
			{
				exitOnCtrlC: false,
				patchConsole: false,
				stderr,
				stdin,
				stdout,
			},
		);

		try {
			await waitFor(
				() => FakeWebSocket.instances.length === 1,
				"initial socket",
			);
			const socket = FakeWebSocket.instances[0] as FakeWebSocket;
			socket.dispatch("open");
			await waitFor(() => latest?.status === "connected", "connected status");

			socket.dispatch("message", {
				data: JSON.stringify({
					type: "user_prompt",
					prompt: "hello from telegram",
					source: "telegram",
				}),
			});
			socket.dispatch("message", {
				data: JSON.stringify({
					type: "runtime_status",
					model: "sonnet",
					effort: "think",
					running: true,
				}),
			});
			socket.dispatch("message", {
				data: JSON.stringify({
					type: "text",
					text: "echo: hello from telegram",
				}),
			});

			await waitFor(
				() =>
					latest?.tuiState.messages.at(-1)?.text ===
						"[telegram] hello from telegram" &&
					latest?.tuiState.streaming === "echo: hello from telegram" &&
					latest?.tuiState.running === true,
				"observed streaming state",
			);

			socket.dispatch("message", {
				data: JSON.stringify({
					type: "done",
					sessionId: "sdk-123",
					durationMs: 1,
				}),
			});

			await waitFor(
				() =>
					latest?.tuiState.running === false &&
					latest?.tuiState.streaming === "" &&
					latest?.tuiState.messages.at(-1)?.text ===
						"echo: hello from telegram",
				"observed done state",
			);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});
});
