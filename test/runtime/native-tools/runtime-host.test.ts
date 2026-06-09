import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeNativeToolHost } from "../../../src/runtime/native-tools/runtime-host.ts";

describe("runtime native tool host behavior", () => {
	test("recall sessions lists current-agent chat sessions with provider-qualified refs", async () => {
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			sessions: {
				listSessions: ({ agentId, tag }) => {
					expect(agentId).toBe("agent-default");
					expect(tag).toBe("chat");
					return [
						{
							agentId: "agent-default",
							providerId: "pi",
							sdkSessionId: "thread-1",
							title: "Investigate webhook",
							model: "anthropic/claude-sonnet-4-5",
							tag: "chat",
							lastActive: 1234,
						},
					];
				},
			},
		});

		await expect(host.recall({ mode: "sessions" })).resolves.toEqual({
			ok: true,
			data: {
				mode: "sessions",
				sessions: [
					{
						sessionRef: "pi/thread-1",
						providerId: "pi",
						agentId: "agent-default",
						title: "Investigate webhook",
						model: "anthropic/claude-sonnet-4-5",
						tag: "chat",
						lastActiveAt: 1234,
					},
				],
			},
		});
	});

	test("recall sessions applies selected agent and query filters", async () => {
		const requested: unknown[] = [];
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
			agents: [
				agent("agent-default", "Default", "/agents/default"),
				agent("agent-builder", "Builder", "/agents/builder"),
			],
			currentAgentId: "agent-default",
			recallPolicy: {
				allows: () => true,
			},
			sessions: {
				listSessions: (params) => {
					requested.push(params);
					return {
						sessions: [
							{
								agentId: "agent-builder",
								providerId: "pi",
								sdkSessionId: "thread-builder",
								title: "Deploy checklist",
								tag: "chat",
								lastActive: 4321,
							},
						],
						nextCursor: "cursor-2",
					};
				},
			},
		});

		await expect(
			host.recall({
				mode: "sessions",
				agent: "Builder",
				query: "deploy",
				limit: 5,
				cursor: "cursor-1",
			}),
		).resolves.toMatchObject({
			ok: true,
			data: {
				nextCursor: "cursor-2",
				sessions: [
					{
						agentId: "agent-builder",
						sessionRef: "pi/thread-builder",
						title: "Deploy checklist",
					},
				],
			},
		});
		expect(requested).toEqual([
			{
				agentId: "agent-builder",
				query: "deploy",
				limit: 5,
				cursor: "cursor-1",
				tag: "chat",
			},
		]);
	});

	test("recall sessions rejects cross-agent requests without a policy grant", async () => {
		let called = false;
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
			agents: [
				agent("agent-default", "Default", "/agents/default"),
				agent("agent-builder", "Builder", "/agents/builder"),
			],
			currentAgentId: "agent-default",
			sessions: {
				listSessions: () => {
					called = true;
					return [];
				},
			},
		});

		await expect(
			host.recall({
				mode: "sessions",
				agent: "Builder",
			}),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "policy_denied" },
		});
		expect(called).toBe(false);
	});

	test("recall sessions returns reader validation failures", async () => {
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			sessions: {
				listSessions: () => ({
					ok: false,
					error: {
						code: "validation_error",
						message: "Invalid native session cursor",
					},
				}),
			},
		});

		await expect(
			host.recall({ mode: "sessions", cursor: "not-a-native-cursor" }),
		).resolves.toEqual({
			ok: false,
			error: {
				code: "validation_error",
				message: "Invalid native session cursor",
			},
		});
	});

	test("recall sessions returns transcript search matches and cron rows", async () => {
		const requested: unknown[] = [];
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: true,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			sessions: {
				listSessions: (params) => {
					requested.push(params);
					return [
						{
							agentId: "agent-default",
							providerId: "pi",
							sdkSessionId: "cron-run-1",
							title: "nightly",
							tag: "cron",
							lastActive: 30,
							matches: [
								{
									role: "assistant",
									content: "deployment failed",
									timestamp: 25,
								},
							],
						},
					];
				},
			},
		});

		await expect(
			host.recall({
				mode: "sessions",
				tag: "cron",
				query: "deployment failed",
				limit: 5,
			}),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "sessions",
				sessions: [
					{
						sessionRef: "pi/cron-run-1",
						providerId: "pi",
						agentId: "agent-default",
						title: "nightly",
						tag: "cron",
						lastActiveAt: 30,
						matches: [
							{
								role: "assistant",
								content: "deployment failed",
								timestamp: 25,
							},
						],
					},
				],
			},
		});
		expect(requested).toEqual([
			{
				agentId: "agent-default",
				query: "deployment failed",
				limit: 5,
				tag: "cron",
			},
		]);
	});

	test("recall transcript reads a provider-qualified chat transcript", async () => {
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			sessions: {
				getSession: ({ agentId, providerId, sdkSessionId, tag }) => {
					expect({ agentId, providerId, sdkSessionId, tag }).toEqual({
						agentId: "agent-default",
						providerId: "pi",
						sdkSessionId: "thread-1",
						tag: "chat",
					});
					return {
						agentId,
						providerId,
						sdkSessionId,
						title: "Investigate webhook",
						model: "anthropic/claude-sonnet-4-5",
						tag: "chat",
						lastActive: 1234,
					};
				},
				listSessions: () => [],
			},
			readTranscript: async ({ providerId, sdkSessionId }) => {
				expect({ providerId, sdkSessionId }).toEqual({
					providerId: "pi",
					sdkSessionId: "thread-1",
				});
				return [
					{ role: "user", content: "what failed?", timestamp: 100 },
					{ role: "assistant", content: "the webhook", timestamp: 200 },
				];
			},
		});

		await expect(
			host.recall({
				mode: "transcript",
				sessionRef: "pi/thread-1",
				turns: 1,
			}),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "transcript",
				sessionRef: "pi/thread-1",
				turns: [
					{
						role: "assistant",
						content: "the webhook",
						timestamp: 200,
					},
				],
				truncated: true,
				omittedTurns: 1,
				nextCursor: expect.any(String),
			},
		});
	});

	test("recall transcript defaults to recent non-empty turns with truncation metadata", async () => {
		const transcript = [
			{ role: "user" as const, content: "oldest", timestamp: 1 },
			{ role: "assistant" as const, content: "   ", timestamp: 2 },
			...Array.from({ length: 25 }, (_, index) => ({
				role: "assistant" as const,
				content: `turn ${index + 1}`,
				timestamp: index + 3,
			})),
		];
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			sessions: {
				getSession: ({ agentId, providerId, sdkSessionId, tag }) => ({
					agentId,
					providerId,
					sdkSessionId,
					title: "Long thread",
					tag,
					lastActive: 1234,
				}),
				listSessions: () => [],
			},
			readTranscript: async () => transcript,
		});

		await expect(
			host.recall({
				mode: "transcript",
				sessionRef: "pi/thread-1",
			}),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "transcript",
				sessionRef: "pi/thread-1",
				turns: transcript.slice(-20),
				truncated: true,
				omittedTurns: 6,
				nextCursor: expect.any(String),
			},
		});
	});

	test("recall transcript honors a selected agent", async () => {
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
			agents: [
				agent("agent-default", "Default", "/agents/default"),
				agent("agent-builder", "Builder", "/agents/builder"),
			],
			currentAgentId: "agent-default",
			recallPolicy: {
				allows: () => true,
			},
			sessions: {
				getSession: ({ agentId, providerId, sdkSessionId, tag }) => {
					expect({ agentId, providerId, sdkSessionId, tag }).toEqual({
						agentId: "agent-builder",
						providerId: "pi",
						sdkSessionId: "thread-1",
						tag: "chat",
					});
					return {
						agentId,
						providerId,
						sdkSessionId,
						title: "Builder thread",
						tag: "chat",
						lastActive: 1234,
					};
				},
				listSessions: () => [],
			},
			readTranscript: async () => [
				{ role: "assistant", content: "builder answer", timestamp: 200 },
			],
		});

		await expect(
			host.recall({
				mode: "transcript",
				agent: "Builder",
				sessionRef: "pi/thread-1",
			}),
		).resolves.toMatchObject({
			ok: true,
			data: {
				turns: [{ content: "builder answer" }],
			},
		});
	});

	test("recall transcript honors cron session tags", async () => {
		const sessionCalls: unknown[] = [];
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: true,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			sessions: {
				getSession: (params) => {
					sessionCalls.push(params);
					return {
						agentId: "agent-default",
						providerId: "pi",
						sdkSessionId: "cron-run-1",
						title: "nightly",
						tag: "cron",
						lastActive: 40,
					};
				},
				listSessions: () => [],
			},
			readTranscript: async () => [
				{ role: "assistant", content: "cron failed", timestamp: 39 },
			],
		});

		await expect(
			host.recall({
				mode: "transcript",
				sessionRef: "pi/cron-run-1",
				tag: "cron",
			}),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "transcript",
				sessionRef: "pi/cron-run-1",
				turns: [{ role: "assistant", content: "cron failed", timestamp: 39 }],
			},
		});
		expect(sessionCalls).toEqual([
			{
				agentId: "agent-default",
				providerId: "pi",
				sdkSessionId: "cron-run-1",
				tag: "cron",
			},
		]);
	});

	test("schema lists stale memory schemas from the current agent memory root", async () => {
		const memoryRoot = mkdtempSync(join(tmpdir(), "outclaw-native-schema-"));
		mkdirSync(join(memoryRoot, "schemas"));
		writeFileSync(
			join(memoryRoot, "schemas", "project.md"),
			[
				"---",
				"description: Project memory",
				"last_observation_at: 2026-06-03",
				"last_synthesized: 2026-06-01",
				"---",
				"",
				"# Project",
			].join("\n"),
		);
		writeFileSync(
			join(memoryRoot, "schemas", "fresh.md"),
			[
				"---",
				"description: Fresh memory",
				"last_observation_at: 2026-06-01",
				"last_synthesized: 2026-06-03",
				"---",
			].join("\n"),
		);

		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
			agents: [agent("agent-default", "Default", memoryRoot)],
			currentAgentId: "agent-default",
		});

		await expect(host.schema({ mode: "stale" })).resolves.toEqual({
			ok: true,
			data: {
				mode: "stale",
				schemas: [
					{
						name: "project",
						path: join(memoryRoot, "schemas", "project.md"),
						description: "Project memory",
						lastObservationAt: "2026-06-03",
						lastSynthesized: "2026-06-01",
						status: "stale",
					},
				],
			},
		});
	});

	test("cron failed_status lists failed cron runs for the current agent", async () => {
		const requested: unknown[] = [];
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			cron: {
				listFailedRuns: (params) => {
					requested.push(params);
					return [
						{
							jobName: "nightly-summary",
							sessionRef: "claude/cron-thread-1",
							startedAt: 1234,
							error: "model unavailable",
						},
					];
				},
			},
		});

		await expect(
			host.cron({
				mode: "failed_status",
				jobName: "nightly-summary",
				namesOnly: true,
				sinceEpochMs: 1770000000000,
				limit: 5,
			}),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "failed_status",
				failures: [],
				jobNames: ["nightly-summary"],
			},
		});
		expect(requested).toEqual([
			{
				agentId: "agent-default",
				jobName: "nightly-summary",
				namesOnly: true,
				sinceEpochMs: 1770000000000,
				limit: 5,
			},
		]);
	});

	test("cron failed_status rejects unknown selected agents", async () => {
		let called = false;
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			cron: {
				listFailedRuns: () => {
					called = true;
					return [];
				},
			},
		});

		await expect(
			host.cron({ mode: "failed_status", agent: "Missing" }),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "not_found" },
		});
		expect(called).toBe(false);
	});

	test("cron run triggers a known cron job for the selected agent", async () => {
		const requested: string[] = [];
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
			agents: [
				agent("agent-default", "Default", "/agents/default"),
				agent("agent-builder", "Builder", "/agents/builder"),
			],
			currentAgentId: "agent-default",
			cron: {
				listFailedRuns: () => [],
				runJob: ({ agentId, jobName }) => {
					requested.push(`${agentId}:${jobName}`);
					return {
						accepted: true,
						sessionRef: "pi/cron-thread-1",
					};
				},
			},
		});

		await expect(
			host.cron({
				mode: "run",
				agent: "Builder",
				jobName: "nightly-summary",
			}),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "run",
				jobName: "nightly-summary",
				accepted: true,
				sessionRef: "pi/cron-thread-1",
			},
		});
		expect(requested).toEqual(["agent-builder:nightly-summary"]);
	});

	test("coding status and transcript inspect code-mode sessions", async () => {
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			coding: {
				resolveSession: ({ providerId, sdkSessionId }) => {
					expect({ providerId, sdkSessionId }).toEqual({
						providerId: "codex",
						sdkSessionId: "code-thread-1",
					});
					return {
						providerId,
						sdkSessionId,
						runStatus: "running",
						title: "Implement tool host",
					};
				},
				readEvents: async ({ providerId, sdkSessionId }) => [
					{
						providerId,
						sdkSessionId,
						sequence: 1,
						createdAt: 100,
						event: { type: "user_prompt", text: "build it" },
					},
				],
			},
		});

		await expect(
			host.coding({ mode: "status", sessionRef: "codex/code-thread-1" }),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "status",
				sessionRef: "codex/code-thread-1",
				status: "running",
				summary: "Implement tool host",
			},
		});
		await expect(
			host.coding({
				mode: "transcript",
				sessionRef: "codex/code-thread-1",
			}),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "transcript",
				sessionRef: "codex/code-thread-1",
				events: [
					{
						providerId: "codex",
						sdkSessionId: "code-thread-1",
						sequence: 1,
						createdAt: 100,
						event: { type: "user_prompt", text: "build it" },
					},
				],
			},
		});
	});

	test("coding transcript selects interaction turns unless full is requested", async () => {
		const events = [
			{ type: "user_prompt", text: "first" },
			{ type: "text", text: "one" },
			{ type: "done" },
			{ type: "user_prompt", text: "second" },
			{ type: "text", text: "two" },
			{ type: "done" },
		];
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: true,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			coding: {
				resolveSession: ({ providerId, sdkSessionId }) => ({
					providerId,
					sdkSessionId,
					runStatus: "idle",
				}),
				readEvents: async () => events,
			},
		});

		await expect(
			host.coding({
				mode: "transcript",
				sessionRef: "codex/code-thread-1",
			}),
		).resolves.toMatchObject({
			ok: true,
			data: {
				events: events.slice(3),
			},
		});
		await expect(
			host.coding({
				mode: "transcript",
				sessionRef: "codex/code-thread-1",
				full: true,
			}),
		).resolves.toMatchObject({
			ok: true,
			data: { events },
		});
	});

	test("coding transcript filters tool output and caps returned events", async () => {
		const events = [
			{ type: "user_prompt", text: "inspect" },
			{ type: "command_execution_output", text: "large raw output" },
			...Array.from({ length: 240 }, (_, index) => ({
				type: "text",
				text: `delta ${index + 1}`,
			})),
			{ type: "done" },
		];
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: true,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			coding: {
				resolveSession: ({ providerId, sdkSessionId }) => ({
					providerId,
					sdkSessionId,
					runStatus: "idle",
				}),
				readEvents: async () => events,
			},
		});

		const result = await host.coding({
			mode: "transcript",
			sessionRef: "codex/code-thread-1",
		});

		expect(result).toMatchObject({
			ok: true,
			data: {
				mode: "transcript",
				sessionRef: "codex/code-thread-1",
				truncated: true,
				omittedEvents: 42,
				nextCursor: expect.any(String),
			},
		});
		if (result.ok && result.data.mode === "transcript") {
			expect(result.data.events).toHaveLength(200);
			expect(result.data.events).not.toContainEqual(
				expect.objectContaining({ type: "command_execution_output" }),
			);
			expect(result.data.events.at(-1)).toEqual({ type: "done" });
		}
	});

	test("coding list returns repositories and recent coding sessions", async () => {
		const requested: unknown[] = [];
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: true,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			coding: {
				resolveSession: () => undefined,
				readEvents: async () => [],
				list: (params) => {
					requested.push(params);
					return {
						repositories: [
							{
								id: "repo-1",
								rootCwd: "/repo",
								displayName: "Repo",
								source: "auto",
								status: "active",
								lastActive: 20,
							},
						],
						sessions: [
							{
								providerId: "codex",
								sdkSessionId: "code-thread-1",
								title: "Fix parser",
								runStatus: "running",
								cwd: "/repo",
								repositoryId: "repo-1",
								lastActive: 30,
							},
						],
					};
				},
			},
		});

		await expect(
			host.coding({
				mode: "list",
				repository: "repo-1",
				includeArchived: true,
				limit: 10,
			}),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "list",
				repositories: [
					{
						id: "repo-1",
						rootCwd: "/repo",
						displayName: "Repo",
						source: "auto",
						status: "active",
						lastActiveAt: 20,
					},
				],
				sessions: [
					{
						sessionRef: "codex/code-thread-1",
						providerId: "codex",
						sdkSessionId: "code-thread-1",
						title: "Fix parser",
						status: "running",
						cwd: "/repo",
						repositoryId: "repo-1",
						lastActiveAt: 30,
					},
				],
			},
		});
		expect(requested).toEqual([
			{ repository: "repo-1", includeArchived: true, limit: 10 },
		]);
	});

	test("coding status returns final response and failure details", async () => {
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: true,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			coding: {
				resolveSession: ({ sdkSessionId }) => ({
					providerId: "codex",
					sdkSessionId,
					runStatus: sdkSessionId === "failed-thread" ? "failed" : "idle",
					title: "Fix parser",
					cwd: "/repo",
					lastActive: 50,
					...(sdkSessionId === "failed-thread"
						? { failureMessage: "tests failed" }
						: {}),
				}),
				readEvents: async () => [
					{ type: "user_prompt", text: "fix parser" },
					{ type: "text", text: "Done" },
					{ type: "text", text: "." },
				],
			},
		});

		await expect(
			host.coding({ mode: "status", sessionRef: "codex/done-thread" }),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "status",
				sessionRef: "codex/done-thread",
				status: "idle",
				summary: "Fix parser",
				cwd: "/repo",
				lastActiveAt: 50,
				lastPrompt: "fix parser",
				finalResponse: "Done.",
			},
		});
		await expect(
			host.coding({ mode: "status", sessionRef: "codex/failed-thread" }),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "status",
				sessionRef: "codex/failed-thread",
				status: "failed",
				summary: "Fix parser",
				cwd: "/repo",
				lastActiveAt: 50,
				error: "tests failed",
			},
		});
	});

	test("coding status blocks until the session is no longer running", async () => {
		let runStatus: "idle" | "running" = "running";
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			coding: {
				resolveSession: ({ providerId, sdkSessionId }) => ({
					providerId,
					sdkSessionId,
					runStatus,
				}),
				readEvents: async () => [],
			},
		});
		setTimeout(() => {
			runStatus = "idle";
		}, 10);

		await expect(
			host.coding({
				mode: "status",
				sessionRef: "codex/code-thread-1",
				block: true,
				timeoutSeconds: 0.1,
			}),
		).resolves.toMatchObject({
			ok: true,
			data: {
				mode: "status",
				status: "idle",
			},
		});
	});

	test("coding start creates a code-mode session", async () => {
		const started: string[] = [];
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				providerSessionRef: "pi/chat-thread-1",
				source: "browser",
				readOnly: false,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			coding: {
				resolveSession: () => undefined,
				readEvents: async () => [],
				start: async ({ target, prompt, cwd, linkedChatSession }) => {
					started.push(
						`${target}:${prompt}:${cwd}:${linkedChatSession?.agentId}/${linkedChatSession?.providerId}/${linkedChatSession?.sdkSessionId}`,
					);
					return {
						providerId: "codex",
						sdkSessionId: "code-thread-2",
						status: "accepted",
						turnId: "turn-1",
					};
				},
			},
		});

		await expect(
			host.coding({
				mode: "start",
				target: "outclaw",
				prompt: "implement native tools",
				cwd: "/repo",
			}),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "start",
				sessionRef: "codex/code-thread-2",
				status: "accepted",
				turnId: "turn-1",
			},
		});
		expect(started).toEqual([
			"outclaw:implement native tools:/repo:agent-default/pi/chat-thread-1",
		]);
	});

	test("coding resume sends a follow-up prompt to a code-mode session", async () => {
		const resumed: string[] = [];
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			coding: {
				resolveSession: () => undefined,
				readEvents: async () => [],
				resume: async ({ providerId, sdkSessionId, prompt }) => {
					resumed.push(`${providerId}/${sdkSessionId}:${prompt}`);
					return {
						providerId,
						sdkSessionId,
						status: "queued",
						turnId: "turn-2",
					};
				},
			},
		});

		await expect(
			host.coding({
				mode: "resume",
				sessionRef: "codex/code-thread-2",
				prompt: "add tests",
			}),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "resume",
				sessionRef: "codex/code-thread-2",
				status: "queued",
				turnId: "turn-2",
			},
		});
		expect(resumed).toEqual(["codex/code-thread-2:add tests"]);
	});

	test("coding cancel stops a code-mode session", async () => {
		const cancelled: string[] = [];
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "browser",
				readOnly: false,
			},
			agents: [agent("agent-default", "Default", "/agents/default")],
			currentAgentId: "agent-default",
			coding: {
				resolveSession: () => undefined,
				readEvents: async () => [],
				cancel: ({ providerId, sdkSessionId }) => {
					cancelled.push(`${providerId}/${sdkSessionId}`);
					return true;
				},
			},
		});

		await expect(
			host.coding({
				mode: "cancel",
				sessionRef: "codex/code-thread-2",
			}),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "cancel",
				sessionRef: "codex/code-thread-2",
				cancelled: true,
			},
		});
		expect(cancelled).toEqual(["codex/code-thread-2"]);
	});

	test("memory note writes a durable note for the current agent", async () => {
		const memoryRoot = mkdtempSync(join(tmpdir(), "outclaw-native-note-"));
		const now = new Date(2026, 5, 4, 9, 30);
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				providerSessionRef: "pi/thread-1",
				source: "browser",
				readOnly: false,
			},
			agents: [agent("agent-default", "Default", memoryRoot)],
			currentAgentId: "agent-default",
			now: () => now,
		});

		const result = await host.memoryNote({
			text: "The user wants native tools.",
			salience: "decision",
			title: "outclaw",
		});

		expect(result).toMatchObject({
			ok: true,
			data: {
				path: join(memoryRoot, "daily-memories", "2026-06-04.md"),
				title: "outclaw",
				timestamp: now.getTime(),
				sessionRef: "pi/thread-1",
			},
		});
		if (!result.ok) {
			throw new Error(result.error.message);
		}
		expect(existsSync(result.data.path)).toBe(true);
		expect(readFileSync(result.data.path, "utf-8")).toContain(
			"- 09:30 [decision] The user wants native tools. [[outclaw]]",
		);
	});

	test("memory note persists title and tags as routing hints", async () => {
		const memoryRoot = mkdtempSync(join(tmpdir(), "outclaw-native-note-tags-"));
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				providerSessionRef: "pi/thread-1",
				source: "browser",
				readOnly: false,
			},
			agents: [agent("agent-default", "Default", memoryRoot)],
			currentAgentId: "agent-default",
			now: () => new Date(2026, 5, 4, 9, 30),
		});

		const result = await host.memoryNote({
			text: "Native tools should replace shell workflow.",
			title: "outclaw",
			tags: ["pi", "native-tools"],
		});

		if (!result.ok) {
			throw new Error(result.error.message);
		}
		expect(readFileSync(result.data.path, "utf-8")).toContain(
			"- 09:30 [routine] Native tools should replace shell workflow. [[outclaw]] [[pi]] [[native-tools]]",
		);
	});

	test("peer message sends and asks another known agent", async () => {
		const sent: string[] = [];
		const askTimeouts: Array<number | undefined> = [];
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				providerSessionRef: "pi/thread-1",
				source: "browser",
				readOnly: false,
			},
			agents: [
				agent("agent-default", "Default", "/agents/default"),
				agent("agent-builder", "Builder", "/agents/builder"),
			],
			currentAgentId: "agent-default",
			peers: {
				send: ({ targetAgentId, message }) => {
					sent.push(`${targetAgentId}:${message}`);
					return true;
				},
				ask: async ({ targetAgentId, message, timeoutSeconds }) => {
					askTimeouts.push(timeoutSeconds);
					return `answer from ${targetAgentId}: ${message}`;
				},
			},
		});

		await expect(
			host.peerMessage({
				mode: "send",
				targetAgent: "Builder",
				message: "please review",
			}),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "send",
				targetAgent: "Builder",
				accepted: true,
				sessionRef: "pi/thread-1",
			},
		});
		await expect(
			host.peerMessage({
				mode: "ask",
				targetAgent: "Builder",
				message: "status?",
			}),
		).resolves.toEqual({
			ok: true,
			data: {
				mode: "ask",
				targetAgent: "Builder",
				accepted: true,
				responseText: "answer from agent-builder: status?",
				sessionRef: "pi/thread-1",
			},
		});
		expect(sent).toEqual(["agent-builder:please review"]);
		expect(askTimeouts).toEqual([120]);
	});

	test("peer message lists known agents without transport setup", async () => {
		const host = createRuntimeNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				providerSessionRef: "pi/thread-1",
				source: "browser",
				readOnly: true,
			},
			agents: [
				agent("agent-default", "Default", "/agents/default"),
				agent("agent-builder", "Builder", "/agents/builder"),
			],
			currentAgentId: "agent-default",
		});

		await expect(host.peerMessage({ mode: "list" })).resolves.toEqual({
			ok: true,
			data: {
				mode: "list",
				agents: [
					{ agentId: "agent-default", name: "Default", current: true },
					{ agentId: "agent-builder", name: "Builder", current: false },
				],
			},
		});
	});
});

function agent(agentId: string, name: string, homeDir: string) {
	return {
		agentId,
		name,
		homeDir,
		memoryRoot: homeDir,
	};
}
