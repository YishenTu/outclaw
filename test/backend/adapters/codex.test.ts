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

	test("normalizes commandExecution item lifecycle into typed events", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "item/started",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "commandExecution",
						id: "call_abc",
						command: "/bin/zsh -lc 'ls -1'",
						cwd: "/work/repo",
						status: "inProgress",
						commandActions: [
							{ type: "listFiles", command: "ls -1", path: null },
						],
						aggregatedOutput: null,
						exitCode: null,
						durationMs: null,
					},
				},
			},
			{
				method: "item/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "commandExecution",
						id: "call_abc",
						command: "/bin/zsh -lc 'ls -1'",
						cwd: "/work/repo",
						status: "completed",
						commandActions: [
							{ type: "listFiles", command: "ls -1", path: null },
						],
						aggregatedOutput: "AGENTS.md\nCLAUDE.md\n",
						exitCode: 0,
						durationMs: 12,
					},
				},
			},
			{
				method: "turn/completed",
				params: {
					threadId: "codex-thread-123",
					turn: { id: "turn-1", durationMs: 20, status: "completed" },
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		const events = await collectEvents(
			adapter.run({
				prompt: "list files",
				cwd: "/work/repo",
				model: "gpt-5.5",
			}),
		);

		expect(events).toEqual([
			{ type: "session_initialized", sessionId: "codex-thread-123" },
			{
				type: "command_execution_started",
				callId: "call_abc",
				command: "ls -1",
				cwd: "/work/repo",
				sessionId: "codex-thread-123",
			},
			{
				type: "command_execution_completed",
				callId: "call_abc",
				exitCode: 0,
				durationMs: 12,
				output: "AGENTS.md\nCLAUDE.md\n",
				sessionId: "codex-thread-123",
			},
			{
				type: "done",
				sessionId: "codex-thread-123",
				durationMs: 20,
			},
		]);
	});

	test("normalizes fileChange items into a single file_change_applied event", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "item/started",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "fileChange",
						id: "call_patch",
						status: "inProgress",
						changes: [
							{
								path: "/tmp/probe.md",
								kind: { type: "add" },
								diff: "first line\n",
							},
						],
					},
				},
			},
			{
				method: "item/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "fileChange",
						id: "call_patch",
						status: "completed",
						changes: [
							{
								path: "/tmp/probe.md",
								kind: { type: "add" },
								diff: "first line\n",
							},
						],
					},
				},
			},
			{
				method: "item/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "fileChange",
						id: "call_patch_update",
						status: "completed",
						changes: [
							{
								path: "/tmp/probe.md",
								kind: { type: "update", move_path: null },
								diff: "@@ -1 +1,2 @@\n first line\n+second line\n",
							},
						],
					},
				},
			},
			{
				method: "turn/completed",
				params: {
					threadId: "codex-thread-123",
					turn: { id: "turn-1", durationMs: 100, status: "completed" },
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		const events = await collectEvents(
			adapter.run({
				prompt: "edit",
				cwd: "/work/repo",
			}),
		);

		expect(events).toEqual([
			{ type: "session_initialized", sessionId: "codex-thread-123" },
			{
				type: "file_change_applied",
				callId: "call_patch",
				changes: [
					{
						path: "/tmp/probe.md",
						kind: "add",
						diff: "first line\n",
					},
				],
				sessionId: "codex-thread-123",
			},
			{
				type: "file_change_applied",
				callId: "call_patch_update",
				changes: [
					{
						path: "/tmp/probe.md",
						kind: "update",
						diff: "@@ -1 +1,2 @@\n first line\n+second line\n",
					},
				],
				sessionId: "codex-thread-123",
			},
			{ type: "done", sessionId: "codex-thread-123", durationMs: 100 },
		]);
	});

	test("disposes its app-server client", async () => {
		const client = new FakeCodexAppServerClient([]);
		const adapter = new CodexAdapter({ client });

		await adapter.dispose();

		expect(client.dispose).toHaveBeenCalledTimes(1);
	});

	test("listModels() pages through model/list and returns visible models", async () => {
		const client = new FakeModelListClient([
			{
				data: [
					{
						id: "gpt-5.5",
						model: "gpt-5.5",
						displayName: "GPT-5.5",
						description: "Frontier model.",
						hidden: false,
						isDefault: true,
						defaultReasoningEffort: "medium",
						supportedReasoningEfforts: [
							{ reasoningEffort: "low", description: "fast" },
							{ reasoningEffort: "medium", description: "balanced" },
							{ reasoningEffort: "high", description: "deep" },
							{ reasoningEffort: "xhigh", description: "deepest" },
						],
						serviceTiers: [
							{
								id: "priority",
								name: "Fast",
								description: "1.5x speed, increased usage",
							},
						],
					},
					{
						id: "internal-hidden",
						model: "internal-hidden",
						displayName: "Hidden",
						description: "",
						hidden: true,
						isDefault: false,
						defaultReasoningEffort: "medium",
						supportedReasoningEfforts: [
							{ reasoningEffort: "medium", description: "" },
						],
					},
				],
				nextCursor: "cursor-1",
			},
			{
				data: [
					{
						id: "gpt-5.4-mini",
						model: "gpt-5.4-mini",
						displayName: "GPT-5.4-Mini",
						description: "Small, fast.",
						hidden: false,
						isDefault: false,
						defaultReasoningEffort: "medium",
						supportedReasoningEfforts: [
							{ reasoningEffort: "low", description: "" },
							{ reasoningEffort: "medium", description: "" },
						],
					},
				],
				nextCursor: null,
			},
		]);
		const adapter = new CodexAdapter({ client });

		const models = await adapter.listModels();

		expect(client.initialize).toHaveBeenCalledTimes(1);
		expect(client.requests).toEqual([
			{ method: "model/list", params: {} },
			{ method: "model/list", params: { cursor: "cursor-1" } },
		]);
		expect(models).toEqual([
			{
				id: "gpt-5.5",
				model: "gpt-5.5",
				displayName: "GPT-5.5",
				description: "Frontier model.",
				isDefault: true,
				defaultReasoningEffort: "medium",
				supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
				serviceTiers: [
					{
						id: "priority",
						name: "Fast",
						description: "1.5x speed, increased usage",
					},
				],
			},
			{
				id: "gpt-5.4-mini",
				model: "gpt-5.4-mini",
				displayName: "GPT-5.4-Mini",
				description: "Small, fast.",
				isDefault: false,
				defaultReasoningEffort: "medium",
				supportedReasoningEfforts: ["low", "medium"],
				serviceTiers: [],
			},
		]);
	});
});

class FakeModelListClient implements CodexAppServerClient {
	readonly initialize = mock(async () => {});
	readonly notify = mock((_method: string, _params?: unknown) => {});
	readonly dispose = mock(async () => {});
	readonly requests: Array<{ method: string; params: unknown }> = [];

	constructor(private readonly pages: Array<Record<string, unknown>>) {}

	async request<T>(method: string, params: unknown): Promise<T> {
		this.requests.push({ method, params });
		if (method === "model/list") {
			const page = this.pages.shift();
			if (!page) {
				throw new Error("Exhausted model/list pages");
			}
			return page as T;
		}
		throw new Error(`Unexpected request: ${method}`);
	}

	subscribe(
		_handler: (notification: CodexServerNotification) => void,
	): () => void {
		return () => {};
	}
}
