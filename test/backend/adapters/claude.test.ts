import { describe, expect, mock, test } from "bun:test";

describe("ClaudeAdapter", () => {
	test("implements Facade interface", async () => {
		mock.module("@anthropic-ai/claude-agent-sdk", () => ({
			query: mock(() => (async function* () {})()),
		}));

		const { ClaudeAdapter } = await import(
			"../../../src/backend/adapters/claude.ts"
		);
		const adapter = new ClaudeAdapter();
		expect(adapter.run).toBeFunction();
	});

	test("run() returns an async iterable", async () => {
		mock.module("@anthropic-ai/claude-agent-sdk", () => ({
			query: mock(() => (async function* () {})()),
		}));

		const { ClaudeAdapter } = await import(
			"../../../src/backend/adapters/claude.ts"
		);
		const adapter = new ClaudeAdapter();
		const result = adapter.run({ prompt: "hello" });
		expect(result[Symbol.asyncIterator]).toBeFunction();
	});

	test("streams text deltas and maps usage info from SDK events", async () => {
		const query = mock((_params: unknown) =>
			(async function* () {
				yield {
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "hel" },
					},
				};
				yield {
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "lo" },
					},
				};
				yield {
					type: "result",
					session_id: "sdk-123",
					duration_ms: 321,
					total_cost_usd: 0.12,
					modelUsage: {
						"claude-opus-4-6[1m]": {
							contextWindow: 1_000_000,
							maxOutputTokens: 64_000,
						},
					},
					usage: {
						input_tokens: 100,
						output_tokens: 25,
						cache_creation_input_tokens: 50,
						cache_read_input_tokens: 150,
					},
				};
			})(),
		);

		mock.module("@anthropic-ai/claude-agent-sdk", () => ({ query }));

		const { ClaudeAdapter } = await import(
			"../../../src/backend/adapters/claude.ts"
		);
		const adapter = new ClaudeAdapter();
		const events = [];

		for await (const event of adapter.run({
			prompt: "hello",
			systemPrompt: "system",
			resume: "sdk-123",
			maxTurns: 2,
			cwd: "/tmp/misanthropic",
			model: "claude-opus-4-6[1m]",
			effort: "max",
		})) {
			events.push(event);
		}

		const args = query.mock.calls[0]?.[0] as {
			prompt: string;
			options: {
				systemPrompt?: string;
				abortController?: AbortController;
				resume?: string;
				maxTurns?: number;
				cwd?: string;
				model?: string;
				effort?: string;
				permissionMode?: string;
				allowDangerouslySkipPermissions?: boolean;
				includePartialMessages?: boolean;
			};
		};

		expect(args.prompt).toBe("hello");
		expect(args.options.systemPrompt).toBe("system");
		expect(args.options.resume).toBe("sdk-123");
		expect(args.options.maxTurns).toBe(2);
		expect(args.options.cwd).toBe("/tmp/misanthropic");
		expect(args.options.model).toBe("claude-opus-4-6[1m]");
		expect(args.options.effort).toBe("max");
		expect(args.options.permissionMode).toBe("bypassPermissions");
		expect(args.options.allowDangerouslySkipPermissions).toBe(true);
		expect(args.options.includePartialMessages).toBe(true);
		expect(args.options.abortController).toBeInstanceOf(AbortController);

		expect(events).toEqual([
			{ type: "text", text: "hel" },
			{ type: "text", text: "lo" },
			{
				type: "done",
				sessionId: "sdk-123",
				durationMs: 321,
				costUsd: 0.12,
				usage: {
					inputTokens: 100,
					outputTokens: 25,
					cacheCreationTokens: 50,
					cacheReadTokens: 150,
					contextWindow: 1_000_000,
					maxOutputTokens: 64_000,
					contextTokens: 300,
					percentage: 0,
				},
			},
		]);
	});

	test("yields an error event when the SDK run fails", async () => {
		const query = mock(() =>
			(async function* () {
				yield {
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "not_text", text: "" },
					},
				};
				throw new Error("sdk boom");
			})(),
		);

		mock.module("@anthropic-ai/claude-agent-sdk", () => ({ query }));

		const { ClaudeAdapter } = await import(
			"../../../src/backend/adapters/claude.ts"
		);
		const adapter = new ClaudeAdapter();
		const events = [];

		for await (const event of adapter.run({ prompt: "hello" })) {
			events.push(event);
		}

		expect(events).toEqual([{ type: "error", message: "sdk boom" }]);
	});
});
