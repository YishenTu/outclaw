import { describe, expect, mock, test } from "bun:test";
import { CodexAdapter } from "../../../src/backend/adapters/codex/index.ts";
import type {
	CodexAppServerClient,
	CodexServerNotification,
} from "../../../src/backend/adapters/codex/types.ts";
import type { FacadeEvent } from "../../../src/common/protocol.ts";

class FakeCodexAppServerClient implements CodexAppServerClient {
	readonly initialize = mock(async () => {});
	readonly notify = mock((_method: string, _params?: unknown) => {});
	readonly dispose = mock(async () => {});
	readonly requests: Array<{ method: string; params: unknown }> = [];
	private readonly subscribers = new Set<
		(notification: CodexServerNotification) => void
	>();

	constructor(private readonly turnNotifications: CodexServerNotification[]) {}

	async request<T>(method: string, params: unknown): Promise<T> {
		this.requests.push({ method, params });

		if (method === "thread/start") {
			return {
				thread: {
					id: "codex-thread-123",
					sessionId: "codex-session-tree",
					path: null,
				},
			} as T;
		}

		if (method === "turn/start") {
			for (const notification of this.turnNotifications) {
				this.emit(notification);
			}
			return {
				turn: {
					id: "turn-1",
					durationMs: 25,
				},
			} as T;
		}

		throw new Error(`Unexpected request: ${method}`);
	}

	subscribe(
		handler: (notification: CodexServerNotification) => void,
	): () => void {
		this.subscribers.add(handler);
		return () => {
			this.subscribers.delete(handler);
		};
	}

	private emit(notification: CodexServerNotification): void {
		for (const subscriber of this.subscribers) {
			subscriber(notification);
		}
	}
}

async function collectEvents(
	events: AsyncIterable<FacadeEvent>,
): Promise<FacadeEvent[]> {
	const collected: FacadeEvent[] = [];
	for await (const event of events) {
		collected.push(event);
	}
	return collected;
}

describe("CodexAdapter", () => {
	test("streams a simple app-server turn through the Facade contract", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "item/agentMessage/delta",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					itemId: "message-1",
					delta: "Hello",
				},
			},
			{
				method: "item/agentMessage/delta",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					itemId: "message-1",
					delta: " from Codex",
				},
			},
			{
				method: "turn/completed",
				params: {
					threadId: "codex-thread-123",
					turn: {
						id: "turn-1",
						durationMs: 31,
						status: "completed",
					},
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		const events = await collectEvents(
			adapter.run({
				prompt: "say hello",
				cwd: "/work/repo",
				model: "gpt-5.5",
				effort: "high",
			}),
		);

		expect(adapter.providerId).toBe("codex");
		expect(client.initialize).toHaveBeenCalledTimes(1);
		expect(client.requests).toEqual([
			{
				method: "thread/start",
				params: {
					model: "gpt-5.5",
					cwd: "/work/repo",
					experimentalRawEvents: false,
					persistExtendedHistory: true,
				},
			},
			{
				method: "turn/start",
				params: {
					threadId: "codex-thread-123",
					input: [{ type: "text", text: "say hello", text_elements: [] }],
					model: "gpt-5.5",
					effort: "high",
				},
			},
		]);
		expect(events).toEqual([
			{
				type: "session_initialized",
				sessionId: "codex-thread-123",
			},
			{ type: "text", text: "Hello", sessionId: "codex-thread-123" },
			{ type: "text", text: " from Codex", sessionId: "codex-thread-123" },
			{
				type: "done",
				sessionId: "codex-thread-123",
				durationMs: 31,
			},
		]);
	});

	test("disposes its app-server client", async () => {
		const client = new FakeCodexAppServerClient([]);
		const adapter = new CodexAdapter({ client });

		await adapter.dispose();

		expect(client.dispose).toHaveBeenCalledTimes(1);
	});
});
