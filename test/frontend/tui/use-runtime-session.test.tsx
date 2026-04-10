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

interface Snapshot {
	requestSkills: () => void;
	skills: SkillInfo[];
	status: string;
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
			requestSkills: session.requestSkills,
			skills: session.skills,
			status: session.status,
		});
	}, [onSnapshot, session.requestSkills, session.skills, session.status]);

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

			vi.useFakeTimers();
			firstSocket.dispatch("close");
			await waitFor(
				() => latest?.status === "disconnected",
				"disconnected status",
			);
			expect(latest?.skills).toEqual([]);

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
});
