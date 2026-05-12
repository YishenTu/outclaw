import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAdapter } from "../../../src/backend/adapters/codex/index.ts";
import { normalizeCodexJsonlEvents } from "../../../src/backend/adapters/codex/stream-normalizer.ts";
import type {
	CodexAppServerClient,
	CodexServerNotification,
} from "../../../src/backend/adapters/codex/types.ts";
import type { FacadeEvent } from "../../../src/common/protocol.ts";

interface FakeCodexAppServerClientOptions {
	threadPath?: string | null;
}

class FakeCodexAppServerClient implements CodexAppServerClient {
	readonly initialize = mock(async () => {});
	readonly notify = mock((_method: string, _params?: unknown) => {});
	readonly dispose = mock(async () => {});
	readonly requests: Array<{ method: string; params: unknown }> = [];
	private readonly subscribers = new Set<
		(notification: CodexServerNotification) => void
	>();

	constructor(
		private readonly turnNotifications: CodexServerNotification[],
		private readonly options: FakeCodexAppServerClientOptions = {},
	) {}

	async request<T>(method: string, params: unknown): Promise<T> {
		this.requests.push({ method, params });

		if (method === "thread/start") {
			return {
				thread: {
					id: "codex-thread-123",
					sessionId: "codex-session-tree",
					path: this.options.threadPath ?? null,
				},
			} as T;
		}

		if (method === "thread/resume") {
			const paramsRecord =
				typeof params === "object" && params !== null
					? (params as Record<string, unknown>)
					: {};
			return {
				thread: {
					id:
						typeof paramsRecord.threadId === "string"
							? paramsRecord.threadId
							: "codex-thread-123",
					sessionId: "codex-session-tree",
					path: this.options.threadPath ?? null,
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
					experimentalRawEvents: true,
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

	test("requests raw events when resuming a Codex thread", async () => {
		const client = new FakeCodexAppServerClient([
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

		await collectEvents(
			adapter.run({
				prompt: "continue",
				resume: "codex-thread-123",
				cwd: "/work/repo",
			}),
		);

		expect(client.requests[0]).toEqual({
			method: "thread/resume",
			params: {
				threadId: "codex-thread-123",
				cwd: "/work/repo",
				experimentalRawEvents: true,
			},
		});
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

	test("normalizes raw non-command function outputs as generic tool results", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "rawResponseItem/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "function_call",
						name: "view_image",
						call_id: "call_view",
						arguments: JSON.stringify({ path: "/tmp/preview.png" }),
					},
				},
			},
			{
				method: "rawResponseItem/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "function_call_output",
						call_id: "call_view",
						output: "Rendered /tmp/preview.png",
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
			adapter.run({ prompt: "view image", cwd: "/work/repo" }),
		);

		expect(events).toEqual([
			{ type: "session_initialized", sessionId: "codex-thread-123" },
			{
				type: "tool_call_started",
				callId: "call_view",
				toolKind: "view_image",
				details: [
					{
						label: "arguments",
						value: '{"path":"/tmp/preview.png"}',
					},
				],
				sessionId: "codex-thread-123",
			},
			{
				type: "tool_call_completed",
				callId: "call_view",
				toolKind: "view_image",
				details: [
					{
						label: "output",
						value: "Rendered /tmp/preview.png",
					},
				],
				sessionId: "codex-thread-123",
			},
			{ type: "done", sessionId: "codex-thread-123", durationMs: 20 },
		]);
	});

	test("uses raw response items for complete command tool results while streaming output deltas", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "rawResponseItem/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "function_call",
						name: "exec_command",
						call_id: "call_slow",
						arguments: JSON.stringify({
							cmd: "for n in 1 2; do echo slow-$n; sleep 1; done",
							workdir: "/work/repo",
							yield_time_ms: 4000,
						}),
					},
				},
			},
			{
				method: "item/started",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "commandExecution",
						id: "call_slow",
						command:
							"/bin/zsh -lc 'for n in 1 2; do echo slow-$n; sleep 1; done'",
						cwd: "/work/repo",
						status: "inProgress",
						commandActions: [
							{
								type: "unknown",
								command: "for n in 1 2; do echo slow-$n; sleep 1; done",
							},
						],
						aggregatedOutput: null,
						exitCode: null,
						durationMs: null,
					},
				},
			},
			{
				method: "item/commandExecution/outputDelta",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					itemId: "call_slow",
					delta: "slow-2\n",
				},
			},
			{
				method: "rawResponseItem/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "function_call_output",
						call_id: "call_slow",
						output:
							"Chunk ID: abc\nWall time: 1.0000 seconds\nProcess exited with code 0\nOriginal token count: 4\nOutput:\nslow-1\nslow-2\n",
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
						id: "call_slow",
						command:
							"/bin/zsh -lc 'for n in 1 2; do echo slow-$n; sleep 1; done'",
						cwd: "/work/repo",
						status: "completed",
						commandActions: [
							{
								type: "unknown",
								command: "for n in 1 2; do echo slow-$n; sleep 1; done",
							},
						],
						aggregatedOutput: "slow-2\n",
						exitCode: 0,
						durationMs: 1000,
					},
				},
			},
			{
				method: "turn/completed",
				params: {
					threadId: "codex-thread-123",
					turn: { id: "turn-1", durationMs: 1010, status: "completed" },
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		const events = await collectEvents(
			adapter.run({ prompt: "run slow command", cwd: "/work/repo" }),
		);

		expect(events).toEqual([
			{ type: "session_initialized", sessionId: "codex-thread-123" },
			{
				type: "command_execution_started",
				callId: "call_slow",
				command: "for n in 1 2; do echo slow-$n; sleep 1; done",
				cwd: "/work/repo",
				sessionId: "codex-thread-123",
			},
			{
				type: "command_execution_output",
				callId: "call_slow",
				output: "slow-2\n",
				sessionId: "codex-thread-123",
			},
			{
				type: "command_execution_completed",
				callId: "call_slow",
				exitCode: 0,
				durationMs: 1000,
				output: "slow-1\nslow-2\n",
				sessionId: "codex-thread-123",
			},
			{ type: "done", sessionId: "codex-thread-123", durationMs: 1010 },
		]);
	});

	test("rehydrates Codex JSONL rows into the same content-bearing coding events", () => {
		const jsonl = [
			{
				type: "response_item",
				payload: {
					type: "reasoning",
					summary: [],
					content: [{ type: "reasoning_text", text: "inspect files" }],
					encrypted_content: null,
				},
			},
			{
				type: "response_item",
				payload: {
					type: "function_call",
					name: "exec_command",
					call_id: "call_ls",
					arguments: JSON.stringify({
						cmd: "ls -1",
						workdir: "/work/repo",
						yield_time_ms: 1000,
					}),
				},
			},
			{
				type: "response_item",
				payload: {
					type: "function_call_output",
					call_id: "call_ls",
					output:
						"Chunk ID: abc\nWall time: 0.0000 seconds\nProcess exited with code 0\nOriginal token count: 2\nOutput:\npackage.json\nsrc\n",
				},
			},
			{
				type: "event_msg",
				payload: {
					type: "patch_apply_end",
					call_id: "call_patch",
					success: true,
					changes: {
						"/work/repo/notes.txt": {
							type: "update",
							unified_diff: "@@ -1 +1,2 @@\n one\n+two\n",
							move_path: null,
						},
					},
				},
			},
			{
				type: "event_msg",
				payload: {
					type: "web_search_end",
					call_id: "ws_1",
					query: "OpenAI Codex app-server JSON-RPC",
					action: {
						type: "search",
						query: "OpenAI Codex app-server JSON-RPC",
						queries: ["OpenAI Codex app-server JSON-RPC"],
					},
				},
			},
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "assistant",
					content: [{ type: "output_text", text: "Done." }],
					phase: "final_answer",
				},
			},
		]
			.map((row) => JSON.stringify(row))
			.join("\n");

		expect(
			normalizeCodexJsonlEvents(jsonl, { sessionId: "codex-thread-123" }),
		).toEqual([
			{
				type: "thinking",
				text: "inspect files",
				sessionId: "codex-thread-123",
			},
			{
				type: "command_execution_started",
				callId: "call_ls",
				command: "ls -1",
				cwd: "/work/repo",
				sessionId: "codex-thread-123",
			},
			{
				type: "command_execution_completed",
				callId: "call_ls",
				output: "package.json\nsrc\n",
				sessionId: "codex-thread-123",
			},
			{
				type: "file_change_applied",
				callId: "call_patch",
				changes: [
					{
						path: "/work/repo/notes.txt",
						kind: "update",
						diff: "@@ -1 +1,2 @@\n one\n+two\n",
					},
				],
				sessionId: "codex-thread-123",
			},
			{
				type: "web_search_completed",
				callId: "ws_1",
				query: "OpenAI Codex app-server JSON-RPC",
				queries: ["OpenAI Codex app-server JSON-RPC"],
				sessionId: "codex-thread-123",
			},
			{
				type: "text",
				text: "Done.",
				sessionId: "codex-thread-123",
			},
		]);
	});

	test("reads normalized coding events from a resumed thread JSONL transcript", async () => {
		const root = mkdtempSync(join(tmpdir(), "outclaw-codex-jsonl-"));
		try {
			const transcriptPath = join(root, "codex-thread-123.jsonl");
			writeFileSync(
				transcriptPath,
				[
					{
						type: "response_item",
						payload: {
							type: "reasoning",
							content: [{ type: "reasoning_text", text: "check cwd" }],
							summary: [],
						},
					},
					{
						type: "response_item",
						payload: {
							type: "message",
							role: "assistant",
							content: [{ type: "output_text", text: "Ready." }],
						},
					},
				]
					.map((row) => JSON.stringify(row))
					.join("\n"),
			);
			const client = new FakeCodexAppServerClient([], {
				threadPath: transcriptPath,
			});
			const adapter = new CodexAdapter({ client });

			await expect(
				adapter.readCodingSessionEvents("codex-thread-123"),
			).resolves.toEqual([
				{
					type: "thinking",
					text: "check cwd",
					sessionId: "codex-thread-123",
				},
				{
					type: "text",
					text: "Ready.",
					sessionId: "codex-thread-123",
				},
			]);
			expect(client.requests).toEqual([
				{
					method: "thread/resume",
					params: { threadId: "codex-thread-123" },
				},
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("ends the turn when the final assistant message completes before a background command", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "item/started",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "commandExecution",
						id: "call_background",
						command: "/bin/zsh -lc 'sleep 30 && echo late'",
						cwd: "/work/repo",
						status: "inProgress",
						commandActions: [
							{
								type: "unknown",
								command: "sleep 30 && echo late",
							},
						],
					},
				},
			},
			{
				method: "item/started",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "agentMessage",
						id: "answer-1",
						phase: "final_answer",
					},
				},
			},
			{
				method: "item/agentMessage/delta",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					itemId: "answer-1",
					delta: "The command is running in the background.",
				},
			},
			{
				method: "item/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "agentMessage",
						id: "answer-1",
						text: "The command is running in the background.",
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
						id: "call_background",
						status: "completed",
						aggregatedOutput: "late\n",
						exitCode: 0,
						durationMs: 30_000,
					},
				},
			},
			{
				method: "turn/completed",
				params: {
					threadId: "codex-thread-123",
					turn: {
						id: "turn-1",
						durationMs: 30_100,
						status: "completed",
					},
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		const events = await collectEvents(
			adapter.run({ prompt: "start background command", cwd: "/work/repo" }),
		);

		expect(events.map((event) => event.type)).toEqual([
			"session_initialized",
			"command_execution_started",
			"text",
			"done",
		]);
		expect(events[3]).toMatchObject({
			type: "done",
			sessionId: "codex-thread-123",
		});
		expect(typeof (events[3] as { durationMs?: unknown }).durationMs).toBe(
			"number",
		);
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

	test("normalizes webSearch items into typed web_search events", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "item/started",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "webSearch",
						id: "ws_abc",
						query: "",
						action: { type: "other" },
					},
				},
			},
			{
				method: "item/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "webSearch",
						id: "ws_abc",
						query: "openai codex cli",
						action: {
							type: "search",
							query: "openai codex cli",
							queries: ["openai codex cli"],
						},
					},
				},
			},
			{
				method: "turn/completed",
				params: {
					threadId: "codex-thread-123",
					turn: { id: "turn-1", durationMs: 30, status: "completed" },
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		const events = await collectEvents(
			adapter.run({ prompt: "search", cwd: "/work/repo" }),
		);

		expect(events).toEqual([
			{ type: "session_initialized", sessionId: "codex-thread-123" },
			{
				type: "web_search_started",
				callId: "ws_abc",
				sessionId: "codex-thread-123",
			},
			{
				type: "web_search_completed",
				callId: "ws_abc",
				query: "openai codex cli",
				queries: ["openai codex cli"],
				sessionId: "codex-thread-123",
			},
			{ type: "done", sessionId: "codex-thread-123", durationMs: 30 },
		]);
	});

	test("does not emit done after a terminal Codex turn error", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "error",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					error: { message: "Codex turn failed" },
				},
			},
			{
				method: "turn/completed",
				params: {
					threadId: "codex-thread-123",
					turn: {
						id: "turn-1",
						durationMs: 12,
						status: "failed",
					},
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		const events = await collectEvents(
			adapter.run({ prompt: "fail", cwd: "/work/repo" }),
		);

		expect(events).toEqual([
			{ type: "session_initialized", sessionId: "codex-thread-123" },
			{
				type: "error",
				message: "Codex turn failed",
				sessionId: "codex-thread-123",
			},
		]);
	});

	test("falls through unknown tool item.type values to generic tool_call events", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "item/started",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "viewImage",
						id: "tool_xyz",
						path: "/tmp/preview.png",
					},
				},
			},
			{
				method: "item/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "viewImage",
						id: "tool_xyz",
						path: "/tmp/preview.png",
						status: "completed",
					},
				},
			},
			{
				method: "turn/completed",
				params: {
					threadId: "codex-thread-123",
					turn: { id: "turn-1", durationMs: 5, status: "completed" },
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		const events = await collectEvents(
			adapter.run({ prompt: "look", cwd: "/work/repo" }),
		);

		const toolEvents = events.filter(
			(e) => e.type === "tool_call_started" || e.type === "tool_call_completed",
		);
		expect(toolEvents).toEqual([
			{
				type: "tool_call_started",
				callId: "tool_xyz",
				toolKind: "viewImage",
				details: [{ label: "path", value: "/tmp/preview.png" }],
				sessionId: "codex-thread-123",
			},
			{
				type: "tool_call_completed",
				callId: "tool_xyz",
				toolKind: "viewImage",
				status: "completed",
				details: [{ label: "path", value: "/tmp/preview.png" }],
				sessionId: "codex-thread-123",
			},
		]);
	});

	test("normalizes collabAgentToolCall items into typed subagent tool events", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "item/started",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "collabAgentToolCall",
						id: "call_spawn",
						tool: "spawnAgent",
						prompt: "Create .context/note.txt",
						model: "gpt-5.4-mini",
						reasoningEffort: "low",
						receiverThreadIds: [],
						agentsStates: {},
					},
				},
			},
			{
				method: "item/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "collabAgentToolCall",
						id: "call_spawn",
						status: "completed",
						tool: "spawnAgent",
						prompt: "Create .context/note.txt",
						model: "gpt-5.4-mini",
						reasoningEffort: "low",
						receiverThreadIds: ["child-1"],
						agentsStates: {
							"child-1": { status: "pendingInit", message: null },
						},
					},
				},
			},
			{
				method: "turn/completed",
				params: {
					threadId: "codex-thread-123",
					turn: { id: "turn-1", durationMs: 5, status: "completed" },
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		const events = await collectEvents(
			adapter.run({ prompt: "spawn", cwd: "/work/repo" }),
		);

		const subagentEvents = events.filter(
			(event) =>
				event.type === "subagent_tool_started" ||
				event.type === "subagent_tool_completed",
		);
		expect(subagentEvents).toEqual([
			{
				type: "subagent_tool_started",
				callId: "call_spawn",
				operation: "spawn",
				prompt: "Create .context/note.txt",
				model: "gpt-5.4-mini",
				reasoningEffort: "low",
				targetIds: [],
				agentStates: [],
				sessionId: "codex-thread-123",
			},
			{
				type: "subagent_tool_completed",
				callId: "call_spawn",
				operation: "spawn",
				status: "completed",
				prompt: "Create .context/note.txt",
				model: "gpt-5.4-mini",
				reasoningEffort: "low",
				targetIds: ["child-1"],
				agentStates: [{ agentId: "child-1", status: "pendingInit" }],
				sessionId: "codex-thread-123",
			},
		]);
	});

	test("does not emit tool_call events for non-tool item types (userMessage / agentMessage / reasoning)", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "item/started",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: { type: "userMessage", id: "u-1" },
				},
			},
			{
				method: "item/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: { type: "userMessage", id: "u-1" },
				},
			},
			{
				method: "item/started",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: { type: "agentMessage", id: "a-1", phase: "final_answer" },
				},
			},
			{
				method: "item/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: { type: "agentMessage", id: "a-1", text: "ok" },
				},
			},
			{
				method: "item/started",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: { type: "reasoning", id: "r-1", summary: [], content: [] },
				},
			},
			{
				method: "item/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: { type: "reasoning", id: "r-1", summary: [], content: [] },
				},
			},
			{
				method: "turn/completed",
				params: {
					threadId: "codex-thread-123",
					turn: { id: "turn-1", durationMs: 1, status: "completed" },
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		const events = await collectEvents(
			adapter.run({ prompt: "x", cwd: "/work/repo" }),
		);

		const toolEvents = events.filter(
			(e) => e.type === "tool_call_started" || e.type === "tool_call_completed",
		);
		expect(toolEvents).toEqual([]);
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
