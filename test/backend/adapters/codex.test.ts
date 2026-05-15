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
import type {
	CodingSessionEvent,
	FacadeEvent,
} from "../../../src/common/protocol.ts";

interface FakeCodexAppServerClientOptions {
	archivedThreads?: Array<{ id: string; name?: string | null }>;
	openThreads?: Array<{ id: string; name?: string | null }>;
	skills?: Array<{
		description?: string;
		enabled?: boolean;
		name: string;
		path: string;
		scope?: string;
		shortDescription?: string;
	}>;
	steerNotifications?: CodexServerNotification[];
	steerTurnId?: string;
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

		if (method === "thread/read") {
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

		if (
			method === "thread/archive" ||
			method === "thread/unarchive" ||
			method === "thread/name/set"
		) {
			return {} as T;
		}

		if (method === "thread/list") {
			const paramsRecord =
				typeof params === "object" && params !== null
					? (params as Record<string, unknown>)
					: {};
			return {
				data: paramsRecord.archived
					? (this.options.archivedThreads ?? [])
					: (this.options.openThreads ?? []),
				nextCursor: null,
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

		if (method === "turn/steer") {
			for (const notification of this.options.steerNotifications ?? []) {
				this.emit(notification);
			}
			return {
				turnId: this.options.steerTurnId ?? "turn-2",
			} as T;
		}

		if (method === "skills/list") {
			return {
				data: [
					{
						cwd:
							typeof params === "object" &&
							params !== null &&
							Array.isArray((params as { cwds?: unknown }).cwds)
								? ((params as { cwds: string[] }).cwds[0] ?? "/work/repo")
								: "/work/repo",
						errors: [],
						skills: this.options.skills ?? [],
					},
				],
			} as T;
		}

		// Default stubs for the Codex Chat project-trust handshake. These
		// match the production behavior that ensureProjectTrusted expects:
		// config/batchWrite is fire-and-forget, config/read reports the
		// project layer values (personality + features) so the verification
		// guard passes.
		if (method === "config/batchWrite") {
			return {} as T;
		}
		if (method === "config/read") {
			return {
				config: {
					personality: "friendly",
					features: { multi_agent: false, memories: false },
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

	emit(notification: CodexServerNotification): void {
		for (const subscriber of this.subscribers) {
			subscriber(notification);
		}
	}
}

async function collectEvents(
	events: AsyncIterable<FacadeEvent>,
): Promise<CodingSessionEvent[]> {
	const collected: CodingSessionEvent[] = [];
	for await (const event of events) {
		collected.push(event);
	}
	return collected;
}

async function waitForRequest(
	client: FakeCodexAppServerClient,
	method: string,
): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (client.requests.some((request) => request.method === method)) {
			return;
		}
		await Bun.sleep(1);
	}
	throw new Error(`Timed out waiting for request: ${method}`);
}

describe("CodexAdapter", () => {
	test("syncs coding session archive, restore, and rename to Codex threads", async () => {
		const client = new FakeCodexAppServerClient([]);
		const adapter = new CodexAdapter({ client });

		await adapter.archiveCodingSession("codex-thread-123");
		await adapter.restoreCodingSession("codex-thread-123");
		await adapter.renameCodingSession("codex-thread-123", "Fix browser UX");

		expect(client.initialize).toHaveBeenCalledTimes(3);
		expect(client.requests).toEqual([
			{
				method: "thread/archive",
				params: { threadId: "codex-thread-123" },
			},
			{
				method: "thread/unarchive",
				params: { threadId: "codex-thread-123" },
			},
			{
				method: "thread/name/set",
				params: {
					threadId: "codex-thread-123",
					name: "Fix browser UX",
				},
			},
		]);
	});

	test("reconciles requested coding sessions from Codex thread lists without importing unknown threads", async () => {
		const client = new FakeCodexAppServerClient([], {
			openThreads: [
				{ id: "known-open", name: " Renamed open " },
				{ id: "external-open", name: "Do not import" },
			],
			archivedThreads: [
				{ id: "known-archived", name: "Archived elsewhere" },
				{ id: "external-archived", name: "Do not import either" },
			],
		});
		const adapter = new CodexAdapter({ client });

		await expect(
			adapter.reconcileCodingSessions?.(["known-open", "known-archived"]),
		).resolves.toEqual([
			{
				sessionId: "known-open",
				lifecycleStatus: "open",
				title: "Renamed open",
			},
			{
				sessionId: "known-archived",
				lifecycleStatus: "archived",
				title: "Archived elsewhere",
			},
		]);
		expect(
			client.requests
				.filter((request) => request.method === "thread/list")
				.map((request) => request.params),
		).toEqual([
			expect.objectContaining({ archived: false }),
			expect.objectContaining({ archived: true }),
		]);
	});

	test("projects Codex thread lifecycle notifications into provider coding session updates", () => {
		const client = new FakeCodexAppServerClient([]);
		const adapter = new CodexAdapter({ client });
		const updates: Array<{
			lifecycleStatus?: "open" | "archived";
			sessionId: string;
			title?: string;
		}> = [];

		const unsubscribe = adapter.subscribeCodingSessionUpdates((update) => {
			updates.push(update);
		});
		client.emit({
			method: "thread/archived",
			params: { threadId: "codex-thread-123" },
		});
		client.emit({
			method: "thread/unarchived",
			params: { threadId: "codex-thread-123" },
		});
		client.emit({
			method: "thread/name/updated",
			params: { threadId: "codex-thread-123", name: "Provider title" },
		});
		client.emit({
			method: "thread/name/updated",
			params: { threadId: "codex-thread-456", name: "" },
		});
		client.emit({
			method: "thread/archived",
			params: { threadId: 123 },
		});
		unsubscribe();
		client.emit({
			method: "thread/archived",
			params: { threadId: "codex-thread-789" },
		});

		expect(updates).toEqual([
			{
				sessionId: "codex-thread-123",
				lifecycleStatus: "archived",
			},
			{
				sessionId: "codex-thread-123",
				lifecycleStatus: "open",
			},
			{
				sessionId: "codex-thread-123",
				title: "Provider title",
			},
		]);
	});

	test("lists enabled Codex skills through the provider skill catalog", async () => {
		const client = new FakeCodexAppServerClient([], {
			skills: [
				{
					name: "review",
					path: "/work/repo/.codex/skills/review/SKILL.md",
					scope: "repo",
					enabled: true,
					shortDescription: "Review the current changes",
					description: "Long review description",
				},
				{
					name: "disabled",
					path: "/home/me/.codex/skills/disabled/SKILL.md",
					scope: "user",
					enabled: false,
					description: "Hidden skill",
				},
			],
		});
		const adapter = new CodexAdapter({ client });

		await expect(
			adapter.listProviderSkills({ cwd: "/work/repo" }),
		).resolves.toEqual([
			{
				name: "review",
				description: "Review the current changes",
				scope: "repo",
			},
		]);
		expect(client.requests).toEqual([
			{
				method: "skills/list",
				params: { cwds: ["/work/repo"] },
			},
		]);
	});

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
					approvalPolicy: "never",
					sandbox: "danger-full-access",
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
					approvalPolicy: "never",
					sandboxPolicy: { type: "dangerFullAccess" },
					summary: "auto",
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

	test("streams live event_msg user and assistant messages through the Facade contract", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "event_msg",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					type: "user_message",
					message: "run ls",
				},
			},
			{
				method: "event_msg",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					type: "agent_message",
					message: "I’ll list the directory.",
					phase: "commentary",
				},
			},
			{
				method: "event_msg",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					type: "agent_message",
					message: "I’ll list the directory. Files: a.ts, b.ts",
					phase: "final_answer",
				},
			},
			{
				method: "event_msg",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					type: "task_complete",
					duration_ms: 31,
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		const events = await collectEvents(
			adapter.run({
				prompt: "say hello",
				cwd: "/work/repo",
			}),
		);

		expect(events).toEqual([
			{
				type: "session_initialized",
				sessionId: "codex-thread-123",
			},
			{
				type: "user_prompt",
				text: "run ls",
				sessionId: "codex-thread-123",
			},
			{
				type: "text",
				text: "I’ll list the directory.",
				sessionId: "codex-thread-123",
			},
			{
				type: "text",
				text: "I’ll list the directory. Files: a.ts, b.ts",
				sessionId: "codex-thread-123",
			},
			{
				type: "done",
				sessionId: "codex-thread-123",
				durationMs: 31,
			},
		]);
	});

	test("normalizes live turn_aborted markers as terminal abort events", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "event_msg",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					type: "user_message",
					message: [
						"<turn_aborted>",
						"The user interrupted the turn.",
						"</turn_aborted>",
					].join("\n"),
				},
			},
			{
				method: "event_msg",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					type: "task_complete",
					duration_ms: 31,
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		const events = await collectEvents(
			adapter.run({
				prompt: "say hello",
				cwd: "/work/repo",
			}),
		);

		expect(events).toEqual([
			{
				type: "session_initialized",
				sessionId: "codex-thread-123",
			},
			{
				type: "turn_aborted",
				sessionId: "codex-thread-123",
			},
		]);
	});

	test("continues streaming after a running Codex turn is steered", async () => {
		const client = new FakeCodexAppServerClient([], {
			steerTurnId: "turn-2",
			steerNotifications: [
				{
					method: "item/agentMessage/delta",
					params: {
						threadId: "codex-thread-123",
						turnId: "turn-2",
						itemId: "message-2",
						delta: "continued output",
					},
				},
				{
					method: "turn/completed",
					params: {
						threadId: "codex-thread-123",
						turn: {
							id: "turn-2",
							durationMs: 41,
							status: "completed",
						},
					},
				},
				{
					method: "turn/completed",
					params: {
						threadId: "codex-thread-123",
						turn: {
							id: "turn-1",
							durationMs: 99,
							status: "completed",
						},
					},
				},
			],
		});
		const adapter = new CodexAdapter({ client });
		const iterator = adapter
			.run({
				prompt: "start",
				cwd: "/work/repo",
			})
			[Symbol.asyncIterator]();

		expect(await iterator.next()).toEqual({
			done: false,
			value: {
				type: "session_initialized",
				sessionId: "codex-thread-123",
			},
		});

		const nextEvent = iterator.next();
		await waitForRequest(client, "turn/start");
		await expect(
			adapter.steerCodingSession({
				sessionId: "codex-thread-123",
				prompt: "keep going",
				cwd: "/work/repo",
			}),
		).resolves.toEqual({
			sessionId: "codex-thread-123",
			turnId: "turn-2",
		});

		expect(await nextEvent).toEqual({
			done: false,
			value: {
				type: "text",
				text: "continued output",
				sessionId: "codex-thread-123",
			},
		});
		expect(await iterator.next()).toEqual({
			done: false,
			value: {
				type: "done",
				sessionId: "codex-thread-123",
				durationMs: 41,
			},
		});
		expect(await iterator.next()).toEqual({
			done: true,
			value: undefined,
		});
	});

	test("resolves explicit $skill prompts into Codex skill inputs", async () => {
		const client = new FakeCodexAppServerClient(
			[
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
			],
			{
				skills: [
					{
						name: "review",
						path: "/work/repo/.codex/skills/review/SKILL.md",
						scope: "repo",
						enabled: true,
						description: "Review changes",
					},
				],
			},
		);
		const adapter = new CodexAdapter({ client });

		await collectEvents(
			adapter.run({
				prompt: "$review inspect this branch",
				cwd: "/work/repo",
			}),
		);

		expect(client.requests).toContainEqual({
			method: "skills/list",
			params: { cwds: ["/work/repo"] },
		});
		expect(client.requests).toContainEqual({
			method: "turn/start",
			params: {
				threadId: "codex-thread-123",
				input: [
					{
						type: "text",
						text: "$review inspect this branch",
						text_elements: [],
					},
					{
						type: "skill",
						name: "review",
						path: "/work/repo/.codex/skills/review/SKILL.md",
					},
				],
				approvalPolicy: "never",
				sandboxPolicy: { type: "dangerFullAccess" },
				summary: "auto",
			},
		});
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
				approvalPolicy: "never",
				sandbox: "danger-full-access",
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
					type: "message",
					role: "user",
					content: [
						{
							type: "input_text",
							text: [
								"# AGENTS.md instructions for /work/repo",
								"",
								"<INSTRUCTIONS>",
								"Use tabs.",
								"</INSTRUCTIONS>",
								"<environment_context>",
								"  <cwd>/work/repo</cwd>",
								"</environment_context>",
							].join("\n"),
						},
					],
				},
			},
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "fix the tests" }],
				},
			},
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
			{
				type: "event_msg",
				payload: {
					type: "task_complete",
					turn_id: "turn-1",
					completed_at: 1778560196,
					duration_ms: 23624,
				},
			},
		]
			.map((row) => JSON.stringify(row))
			.join("\n");

		expect(
			normalizeCodexJsonlEvents(jsonl, { sessionId: "codex-thread-123" }),
		).toEqual([
			{
				type: "user_prompt",
				text: "fix the tests",
				sessionId: "codex-thread-123",
			},
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
				exitCode: 0,
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
			{
				type: "done",
				sessionId: "codex-thread-123",
				durationMs: 23624,
			},
		]);
	});

	test("preserves Codex JSONL row timestamps on chat-replay events", () => {
		const userTimestamp = Date.parse("2026-05-14T02:46:08.444Z");
		const assistantTimestamp = Date.parse("2026-05-14T02:46:11.012Z");
		const doneTimestamp = Date.parse("2026-05-14T02:46:12.200Z");
		const jsonl = [
			{
				timestamp: "2026-05-14T02:46:08.444Z",
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "hi" }],
				},
			},
			{
				timestamp: "2026-05-14T02:46:11.012Z",
				type: "response_item",
				payload: {
					type: "message",
					role: "assistant",
					content: [{ type: "output_text", text: "hello" }],
				},
			},
			{
				timestamp: "2026-05-14T02:46:12.200Z",
				type: "event_msg",
				payload: {
					type: "task_complete",
					duration_ms: 3756,
				},
			},
		]
			.map((row) => JSON.stringify(row))
			.join("\n");

		expect(
			normalizeCodexJsonlEvents(jsonl, { sessionId: "codex-thread-123" }),
		).toEqual([
			{
				type: "user_prompt",
				text: "hi",
				sessionId: "codex-thread-123",
				timestamp: userTimestamp,
			},
			{
				type: "text",
				text: "hello",
				sessionId: "codex-thread-123",
				timestamp: assistantTimestamp,
			},
			{
				type: "done",
				sessionId: "codex-thread-123",
				durationMs: 3756,
				timestamp: doneTimestamp,
			},
		]);
	});

	test("ignores a trailing partial Codex JSONL row during active transcript reads", () => {
		const completeRow = JSON.stringify({
			type: "response_item",
			payload: {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "completed output" }],
			},
		});
		const jsonl = `${completeRow}\n{"type":"response_item","payload":{"type":"message"`;

		expect(
			normalizeCodexJsonlEvents(jsonl, { sessionId: "codex-thread-x" }),
		).toEqual([
			{
				type: "text",
				text: "completed output",
				sessionId: "codex-thread-x",
			},
		]);
	});

	test("treats a final-answer JSONL message as a terminal coding turn", () => {
		const jsonl = [
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "inspect session" }],
				},
			},
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "assistant",
					content: [{ type: "output_text", text: "All set." }],
					phase: "final_answer",
				},
			},
		]
			.map((row) => JSON.stringify(row))
			.join("\n");

		expect(
			normalizeCodexJsonlEvents(jsonl, { sessionId: "codex-thread-final" }),
		).toEqual([
			{
				type: "user_prompt",
				text: "inspect session",
				sessionId: "codex-thread-final",
			},
			{
				type: "text",
				text: "All set.",
				sessionId: "codex-thread-final",
			},
			{
				type: "done",
				sessionId: "codex-thread-final",
				durationMs: 0,
			},
		]);
	});

	test("updates an existing JSONL terminal event instead of duplicating it", () => {
		const jsonl = [
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "apply patch" }],
				},
			},
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "assistant",
					content: [{ type: "output_text", text: "Applied." }],
					phase: "final_answer",
				},
			},
			{
				type: "event_msg",
				payload: {
					type: "patch_apply_end",
					call_id: "call_patch",
					success: true,
					changes: {
						"/work/repo/file.txt": {
							type: "update",
							unified_diff: "@@ -1 +1 @@\n-old\n+new\n",
							move_path: null,
						},
					},
				},
			},
			{
				type: "event_msg",
				payload: {
					type: "task_complete",
					duration_ms: 4200,
				},
			},
		]
			.map((row) => JSON.stringify(row))
			.join("\n");

		expect(
			normalizeCodexJsonlEvents(jsonl, { sessionId: "codex-thread-final" }),
		).toEqual([
			{
				type: "user_prompt",
				text: "apply patch",
				sessionId: "codex-thread-final",
			},
			{
				type: "text",
				text: "Applied.",
				sessionId: "codex-thread-final",
			},
			{
				type: "done",
				sessionId: "codex-thread-final",
				durationMs: 4200,
			},
			{
				type: "file_change_applied",
				callId: "call_patch",
				changes: [
					{
						path: "/work/repo/file.txt",
						kind: "update",
						diff: "@@ -1 +1 @@\n-old\n+new\n",
					},
				],
				sessionId: "codex-thread-final",
			},
		]);
	});

	test("throws on malformed Codex JSONL rows before the active trailing row", () => {
		const completeRow = JSON.stringify({
			type: "response_item",
			payload: {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "completed output" }],
			},
		});
		const jsonl = `${completeRow}\n{"type":"response_item"\n${completeRow}\n`;

		expect(() =>
			normalizeCodexJsonlEvents(jsonl, { sessionId: "codex-thread-x" }),
		).toThrow(SyntaxError);
	});

	test("hides the apply_patch custom_tool_call_output even when the output item omits the tool name", () => {
		// Codex emits `custom_tool_call_output` items without a `name` field
		// (only `call_id` and `output` round-trip from the responses API). The
		// matching `custom_tool_call` (started) IS named "apply_patch" and is
		// already suppressed, so the orphan output must be suppressed too —
		// otherwise it surfaces as a generic tool_call_completed card.
		const jsonl = [
			{
				type: "response_item",
				payload: {
					type: "custom_tool_call",
					name: "apply_patch",
					call_id: "call_patch_1",
					input: "*** Begin Patch\n*** End Patch\n",
				},
			},
			{
				type: "response_item",
				payload: {
					type: "custom_tool_call_output",
					call_id: "call_patch_1",
					output:
						'{"output":"Success. Updated the following files:\\nM /tmp/a.ts\\n","metadata":{"exit_code":0,"duration_seconds":0.0}}',
				},
			},
		]
			.map((row) => JSON.stringify(row))
			.join("\n");

		expect(
			normalizeCodexJsonlEvents(jsonl, { sessionId: "codex-thread-x" }),
		).toEqual([]);
	});

	test("hides the apply_patch custom_tool_call_output from live raw response items too", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "rawResponseItem/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "custom_tool_call",
						name: "apply_patch",
						call_id: "call_patch_live",
						input: "*** Begin Patch\n*** End Patch\n",
					},
				},
			},
			{
				method: "rawResponseItem/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						// Real codex shape: no `name` on the output side.
						type: "custom_tool_call_output",
						call_id: "call_patch_live",
						output:
							'{"output":"Success. Updated the following files:\\nM /tmp/a.ts\\n","metadata":{"exit_code":0,"duration_seconds":0.0}}',
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
			adapter.run({ prompt: "edit a file", cwd: "/work/repo" }),
		);

		// Only the session lifecycle markers should appear — no tool card for
		// the suppressed apply_patch call.
		expect(events).toEqual([
			{ type: "session_initialized", sessionId: "codex-thread-123" },
			{ type: "done", sessionId: "codex-thread-123", durationMs: 5 },
		]);
	});

	test("suppresses apply_patch output when live notifications also emit generic item/completed noise", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "rawResponseItem/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "custom_tool_call",
						name: "apply_patch",
						call_id: "call_patch_live",
						input: "*** Begin Patch\n*** End Patch\n",
					},
				},
			},
			{
				method: "item/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "custom_tool_call_output",
						id: "call_patch_live",
						status: "completed",
						output:
							'{"output":"Success. Updated the following files:\\nM /tmp/a.ts\\n","metadata":{"exit_code":0,"duration_seconds":0.0}}',
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
			adapter.run({ prompt: "edit a file", cwd: "/work/repo" }),
		);

		expect(events).toEqual([
			{ type: "session_initialized", sessionId: "codex-thread-123" },
			{ type: "done", sessionId: "codex-thread-123", durationMs: 5 },
		]);
	});

	test("suppresses live write_stdin transport noise while keeping the command execution stream", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "rawResponseItem/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "function_call",
						name: "exec_command",
						call_id: "call_cmd",
						arguments: JSON.stringify({
							cmd: "bun run check",
							workdir: "/work/repo",
						}),
					},
				},
			},
			{
				method: "item/commandExecution/outputDelta",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					itemId: "call_cmd",
					delta: "streamed output\n",
				},
			},
			{
				method: "rawResponseItem/completed",
				params: {
					threadId: "codex-thread-123",
					turnId: "turn-1",
					item: {
						type: "function_call",
						name: "write_stdin",
						call_id: "call_poll",
						arguments: JSON.stringify({
							session_id: 2404,
							chars: "",
							max_output_tokens: 8000,
							yield_time_ms: 1000,
						}),
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
						call_id: "call_poll",
						output:
							"Chunk ID: abc\nWall time: 1.0000 seconds\nProcess running with session ID 2404\nOriginal token count: 2\nOutput:\nshadow output\n",
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
						id: "call_cmd",
						exitCode: 0,
						durationMs: 12,
						aggregatedOutput: "streamed output\n",
					},
				},
			},
			{
				method: "turn/completed",
				params: {
					threadId: "codex-thread-123",
					turn: { id: "turn-1", durationMs: 12, status: "completed" },
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		const events = await collectEvents(
			adapter.run({ prompt: "run checks", cwd: "/work/repo" }),
		);

		expect(events).toEqual([
			{ type: "session_initialized", sessionId: "codex-thread-123" },
			{
				type: "command_execution_started",
				callId: "call_cmd",
				command: "bun run check",
				cwd: "/work/repo",
				sessionId: "codex-thread-123",
			},
			{
				type: "command_execution_output",
				callId: "call_cmd",
				output: "streamed output\n",
				sessionId: "codex-thread-123",
			},
			{
				type: "command_execution_completed",
				callId: "call_cmd",
				exitCode: 0,
				durationMs: 12,
				output: "streamed output\n",
				sessionId: "codex-thread-123",
			},
			{ type: "done", sessionId: "codex-thread-123", durationMs: 12 },
		]);
	});

	test("maps long-running exec_command JSONL polling into command output instead of write_stdin tool cards", () => {
		const jsonl = [
			{
				type: "response_item",
				payload: {
					type: "function_call",
					name: "exec_command",
					call_id: "call_cmd",
					arguments: JSON.stringify({
						cmd: "bun run check",
						workdir: "/work/repo",
					}),
				},
			},
			{
				type: "response_item",
				payload: {
					type: "function_call_output",
					call_id: "call_cmd",
					output:
						"Chunk ID: aaa\nWall time: 0.0000 seconds\nProcess running with session ID 2404\nOriginal token count: 3\nOutput:\n$ bun run check\n",
				},
			},
			{
				type: "response_item",
				payload: {
					type: "function_call",
					name: "write_stdin",
					call_id: "call_poll",
					arguments: JSON.stringify({
						session_id: 2404,
						chars: "",
						max_output_tokens: 8000,
						yield_time_ms: 1000,
					}),
				},
			},
			{
				type: "response_item",
				payload: {
					type: "function_call_output",
					call_id: "call_poll",
					output:
						"Chunk ID: bbb\nWall time: 1.0000 seconds\nProcess exited with code 0\nOriginal token count: 2\nOutput:\nall good\n",
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
				type: "command_execution_started",
				callId: "call_cmd",
				command: "bun run check",
				cwd: "/work/repo",
				sessionId: "codex-thread-123",
			},
			{
				type: "command_execution_output",
				callId: "call_cmd",
				output: "$ bun run check\n",
				sessionId: "codex-thread-123",
			},
			{
				type: "command_execution_output",
				callId: "call_cmd",
				output: "all good\n",
				sessionId: "codex-thread-123",
			},
			{
				type: "command_execution_completed",
				callId: "call_cmd",
				exitCode: 0,
				sessionId: "codex-thread-123",
			},
			{
				type: "text",
				text: "Done.",
				sessionId: "codex-thread-123",
			},
			{
				type: "done",
				sessionId: "codex-thread-123",
				durationMs: 0,
			},
		]);
	});

	test("strips internal memory citation blocks from JSONL transcript messages", () => {
		const citationBlock = [
			"<oai-mem-citation>",
			"<citation_entries>",
			"MEMORY.md:66-74|note=[recent outclaw coding UI context]",
			"</citation_entries>",
			"<rollout_ids>",
			"</rollout_ids>",
			"</oai-mem-citation>",
		].join("\n");
		const jsonl = [
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: citationBlock }],
				},
			},
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [
						{
							type: "input_text",
							text: `fix the transcript\n\n${citationBlock}`,
						},
					],
				},
			},
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "assistant",
					content: [
						{
							type: "output_text",
							text: `Done.\n\n${citationBlock}`,
						},
					],
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
				type: "user_prompt",
				text: "fix the transcript",
				sessionId: "codex-thread-123",
			},
			{
				type: "text",
				text: "Done.",
				sessionId: "codex-thread-123",
			},
			{
				type: "done",
				sessionId: "codex-thread-123",
				durationMs: 0,
			},
		]);
	});

	test("normalizes JSONL turn_aborted markers as terminal abort events", () => {
		const jsonl = [
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "fix the spinner" }],
				},
			},
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [
						{
							type: "input_text",
							text: [
								"<turn_aborted>",
								"The user interrupted the turn.",
								"</turn_aborted>",
							].join("\n"),
						},
					],
				},
			},
		]
			.map((row) => JSON.stringify(row))
			.join("\n");

		expect(
			normalizeCodexJsonlEvents(jsonl, { sessionId: "codex-thread-abort" }),
		).toEqual([
			{
				type: "user_prompt",
				text: "fix the spinner",
				sessionId: "codex-thread-abort",
			},
			{
				type: "turn_aborted",
				sessionId: "codex-thread-abort",
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
							type: "message",
							role: "user",
							content: [{ type: "input_text", text: "check status" }],
						},
					},
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
					type: "user_prompt",
					text: "check status",
					sessionId: "codex-thread-123",
				},
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
					method: "thread/read",
					params: { threadId: "codex-thread-123", includeTurns: false },
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

	test("Code Mode start sends provider-default instructions and YOLO sandbox", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "turn/completed",
				params: {
					threadId: "codex-thread-123",
					turn: { id: "turn-1", durationMs: 1, status: "completed" },
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		await collectEvents(
			adapter.run({
				prompt: "fix",
				cwd: "/work/repo",
				model: "gpt-5.5",
				instructionPolicy: { mode: "provider_default" },
			}),
		);

		const start = client.requests.find((r) => r.method === "thread/start");
		expect(start?.params).toEqual({
			model: "gpt-5.5",
			cwd: "/work/repo",
			approvalPolicy: "never",
			sandbox: "danger-full-access",
			experimentalRawEvents: true,
		});
		// provider_default mode must not set baseInstructions or project-doc
		// suppression — Codex's own coding instructions and project AGENTS.md
		// must remain loadable for Code Mode.
		const params = start?.params as Record<string, unknown>;
		expect(params.baseInstructions).toBeUndefined();
		expect(params.config).toBeUndefined();
		// Adapter must not emit unsupported arbitrary builtin-tool keys.
		expect(params.disabled_tools).toBeUndefined();
		expect(params.enabled_tools).toBeUndefined();
	});

	test("Code Mode resume sends provider-default instructions and YOLO sandbox", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "turn/completed",
				params: {
					threadId: "codex-thread-123",
					turn: { id: "turn-1", durationMs: 1, status: "completed" },
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		await collectEvents(
			adapter.run({
				prompt: "continue",
				resume: "codex-thread-123",
				cwd: "/work/repo",
				instructionPolicy: { mode: "provider_default" },
			}),
		);

		const resume = client.requests.find((r) => r.method === "thread/resume");
		expect(resume?.params).toEqual({
			threadId: "codex-thread-123",
			cwd: "/work/repo",
			approvalPolicy: "never",
			sandbox: "danger-full-access",
			experimentalRawEvents: true,
		});
		const params = resume?.params as Record<string, unknown>;
		expect(params.baseInstructions).toBeUndefined();
		expect(params.config).toBeUndefined();
	});

	test("Codex Chat start maps the Outclaw system prompt to baseInstructions and suppresses project docs", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "turn/completed",
				params: {
					threadId: "codex-thread-123",
					turn: { id: "turn-1", durationMs: 1, status: "completed" },
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		await collectEvents(
			adapter.run({
				prompt: "hello",
				cwd: "/home/agent",
				model: "gpt-5.5",
				instructionPolicy: {
					mode: "runtime_constructed",
					systemPrompt: "Outclaw chat instructions",
				},
			}),
		);

		const start = client.requests.find((r) => r.method === "thread/start");
		const params = start?.params as Record<string, unknown>;
		expect(params.baseInstructions).toBe("Outclaw chat instructions");
		expect(params.config).toEqual({ project_doc_max_bytes: 0 });
		// Codex Chat keeps the same YOLO/full-access request policy.
		expect(params.approvalPolicy).toBe("never");
		expect(params.sandbox).toBe("danger-full-access");
		expect(params.experimentalRawEvents).toBe(true);
		expect(params.disabled_tools).toBeUndefined();
		expect(params.enabled_tools).toBeUndefined();
	});

	test("Codex Chat resume maps the Outclaw system prompt to baseInstructions and suppresses project docs", async () => {
		const client = new FakeCodexAppServerClient([
			{
				method: "turn/completed",
				params: {
					threadId: "codex-thread-123",
					turn: { id: "turn-1", durationMs: 1, status: "completed" },
				},
			},
		]);
		const adapter = new CodexAdapter({ client });

		await collectEvents(
			adapter.run({
				prompt: "continue",
				resume: "codex-thread-123",
				cwd: "/home/agent",
				instructionPolicy: {
					mode: "runtime_constructed",
					systemPrompt: "Outclaw chat instructions",
				},
			}),
		);

		const resume = client.requests.find((r) => r.method === "thread/resume");
		const params = resume?.params as Record<string, unknown>;
		expect(params.baseInstructions).toBe("Outclaw chat instructions");
		expect(params.config).toEqual({ project_doc_max_bytes: 0 });
		expect(params.approvalPolicy).toBe("never");
		expect(params.sandbox).toBe("danger-full-access");
	});

	test("Codex Chat instruction policy without a system prompt fails loud", async () => {
		const client = new FakeCodexAppServerClient([]);
		const adapter = new CodexAdapter({ client });

		const events = await collectEvents(
			adapter.run({
				prompt: "x",
				cwd: "/home/agent",
				instructionPolicy: { mode: "runtime_constructed" },
			}),
		);

		const error = events.find((event) => event.type === "error");
		expect(error?.type).toBe("error");
		if (error?.type === "error") {
			expect(error.message).toContain("runtime_constructed");
		}
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
				displayName: "GPT 5.5",
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
				displayName: "GPT 5.4 Mini",
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
