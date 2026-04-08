import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

	test("emits image events for assistant-reported local image files", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "mis-images-out-"));
		try {
			const imagePath = join(tmp, "chart.png");
			writeFileSync(imagePath, "png-bytes");

			const query = mock((_params: unknown) =>
				(async function* () {
					yield {
						type: "assistant",
						message: {
							content: [
								{
									type: "text",
									text: `Saved chart to ${imagePath}`,
								},
							],
						},
					};
					yield {
						type: "result",
						session_id: "sdk-456",
						duration_ms: 12,
						total_cost_usd: 0,
					};
				})(),
			);

			mock.module("@anthropic-ai/claude-agent-sdk", () => ({ query }));

			const { ClaudeAdapter } = await import(
				"../../../src/backend/adapters/claude.ts"
			);
			const adapter = new ClaudeAdapter();
			const events = [];

			for await (const event of adapter.run({ prompt: "plot something" })) {
				events.push(event);
			}

			expect(events).toEqual([
				{
					type: "image",
					path: imagePath,
				},
				{
					type: "done",
					sessionId: "sdk-456",
					durationMs: 12,
					costUsd: 0,
					usage: undefined,
				},
			]);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("uses assistant messages as final text when streaming is disabled", async () => {
		const query = mock((_params: unknown) =>
			(async function* () {
				yield {
					type: "assistant",
					message: {
						content: [
							{
								type: "text",
								text: "final answer",
							},
						],
					},
				};
				yield {
					type: "result",
					session_id: "sdk-final",
					duration_ms: 22,
					total_cost_usd: 0,
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
			prompt: "heartbeat",
			stream: false,
		})) {
			events.push(event);
		}

		const args = query.mock.calls[0]?.[0] as {
			options: {
				includePartialMessages?: boolean;
			};
		};

		expect(args.options.includePartialMessages).toBe(false);
		expect(events).toEqual([
			{
				type: "text",
				text: "final answer",
			},
			{
				type: "done",
				sessionId: "sdk-final",
				durationMs: 22,
				costUsd: 0,
				usage: undefined,
			},
		]);
	});

	test("sends multimodal SDK user messages when images are present", async () => {
		const query = mock((_params: unknown) =>
			(async function* () {
				yield {
					type: "result",
					session_id: "sdk-789",
					duration_ms: 10,
					total_cost_usd: 0,
				};
			})(),
		);

		mock.module("@anthropic-ai/claude-agent-sdk", () => ({ query }));

		const tmp = mkdtempSync(join(tmpdir(), "mis-images-"));
		try {
			const imagePath = join(tmp, "cat.png");
			writeFileSync(imagePath, "image-bytes");

			const { ClaudeAdapter } = await import(
				"../../../src/backend/adapters/claude.ts"
			);
			const adapter = new ClaudeAdapter();

			for await (const _event of adapter.run({
				prompt: "describe this image",
				images: [{ path: imagePath, mediaType: "image/png" }],
			})) {
				// Drain
			}

			const args = query.mock.calls[0]?.[0] as {
				prompt:
					| string
					| AsyncIterable<{
							type: string;
							parent_tool_use_id: string | null;
							message: { role: string; content: Array<unknown> };
					  }>;
			};

			expect(typeof args.prompt).not.toBe("string");

			const messages = [];
			for await (const message of args.prompt as AsyncIterable<unknown>) {
				messages.push(message);
			}

			expect(messages).toEqual([
				{
					type: "user",
					parent_tool_use_id: null,
					message: {
						role: "user",
						content: [
							{
								type: "image",
								source: {
									type: "base64",
									media_type: "image/png",
									data: Buffer.from("image-bytes").toString("base64"),
								},
							},
							{ type: "text", text: "describe this image" },
						],
					},
				},
			]);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});
