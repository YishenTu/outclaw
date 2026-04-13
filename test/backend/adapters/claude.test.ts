import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeAdapter } from "../../../src/backend/adapters/claude.ts";

function createAdapter(
	overrides: {
		query?: ReturnType<typeof mock>;
		getSessionMessages?: ReturnType<typeof mock>;
		unlinkFile?: ReturnType<typeof mock>;
		sleep?: (ms: number) => Promise<void>;
	} = {},
) {
	const query = overrides.query ?? mock(() => (async function* () {})());
	const getSessionMessages =
		overrides.getSessionMessages ?? mock(async () => []);
	const unlinkFile = overrides.unlinkFile ?? mock(() => {});
	const sleep = overrides.sleep ?? (async () => {});
	const options: ConstructorParameters<typeof ClaudeAdapter>[0] = {
		sdk: {
			query: query as never,
			getSessionMessages: getSessionMessages as never,
		},
		sleep,
		unlinkFile,
	};
	return {
		adapter: new ClaudeAdapter(options),
		query,
		getSessionMessages,
		unlinkFile,
	};
}

describe("ClaudeAdapter", () => {
	test("implements Facade interface", async () => {
		const { adapter } = createAdapter();
		expect(adapter.providerId).toBe("claude");
		expect(adapter.run).toBeFunction();
		expect(adapter.readHistory).toBeFunction();
	});

	test("run() returns an async iterable", async () => {
		const { adapter } = createAdapter();
		const result = adapter.run({ prompt: "hello" });
		expect(result[Symbol.asyncIterator]).toBeFunction();
	});

	test("encodes reply context only at the provider boundary", async () => {
		const query = mock((_params: unknown) =>
			(async function* () {
				yield {
					type: "result",
					session_id: "sdk-reply",
					duration_ms: 1,
					total_cost_usd: 0,
				};
			})(),
		);

		const { adapter } = createAdapter({ query });

		for await (const _event of adapter.run({
			prompt: "what do you mean?",
			replyContext: { text: 'the "cron" output <ok>' },
		})) {
			// Drain
		}

		const args = query.mock.calls[0]?.[0] as { prompt: string };
		expect(args.prompt).toBe(
			"what do you mean?\n\n<reply-context>the &quot;cron&quot; output &lt;ok&gt;</reply-context>",
		);
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

		const { adapter } = createAdapter({ query });
		const events = [];

		for await (const event of adapter.run({
			prompt: "hello",
			systemPrompt: "system",
			resume: "sdk-123",
			cwd: "/tmp/outclaw",
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
		expect(args.options.cwd).toBe("/tmp/outclaw");
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

	test("streams thinking_delta events as thinking facade events", async () => {
		const query = mock((_params: unknown) =>
			(async function* () {
				yield {
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "thinking_delta", thinking: "let me " },
					},
				};
				yield {
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "thinking_delta", thinking: "reason" },
					},
				};
				yield {
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "answer" },
					},
				};
				yield {
					type: "result",
					session_id: "sdk-think",
					duration_ms: 100,
					total_cost_usd: 0,
				};
			})(),
		);

		const { adapter } = createAdapter({ query });
		const events = [];

		for await (const event of adapter.run({ prompt: "think" })) {
			events.push(event);
		}

		expect(events).toEqual([
			{ type: "thinking", text: "let me " },
			{ type: "thinking", text: "reason" },
			{ type: "text", text: "answer" },
			{
				type: "done",
				sessionId: "sdk-think",
				durationMs: 100,
				costUsd: 0,
				usage: undefined,
			},
		]);
	});

	test("completes streamed thinking from the final assistant message without duplication", async () => {
		const query = mock((_params: unknown) =>
			(async function* () {
				yield {
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "thinking_delta", thinking: "let me" },
					},
				};
				yield {
					type: "assistant",
					message: {
						content: [
							{ type: "thinking", thinking: "let me think" },
							{ type: "text", text: "done" },
						],
					},
				};
				yield {
					type: "result",
					session_id: "sdk-think-complete",
					duration_ms: 40,
					total_cost_usd: 0,
				};
			})(),
		);

		const { adapter } = createAdapter({ query });
		const events = [];

		for await (const event of adapter.run({ prompt: "think" })) {
			events.push(event);
		}

		expect(events).toEqual([
			{ type: "thinking", text: "let me" },
			{ type: "thinking", text: " think" },
			{ type: "text", text: "done" },
			{
				type: "done",
				sessionId: "sdk-think-complete",
				durationMs: 40,
				costUsd: 0,
				usage: undefined,
			},
		]);
	});

	test("extracts thinking blocks from assistant messages", async () => {
		const query = mock((_params: unknown) =>
			(async function* () {
				yield {
					type: "assistant",
					message: {
						content: [
							{ type: "thinking", thinking: "deep thought" },
							{ type: "text", text: "the answer" },
						],
					},
				};
				yield {
					type: "result",
					session_id: "sdk-think2",
					duration_ms: 50,
					total_cost_usd: 0,
				};
			})(),
		);

		const { adapter } = createAdapter({ query });
		const events = [];

		for await (const event of adapter.run({
			prompt: "think",
			stream: false,
		})) {
			events.push(event);
		}

		expect(events).toEqual([
			{ type: "thinking", text: "deep thought" },
			{ type: "text", text: "the answer" },
			{
				type: "done",
				sessionId: "sdk-think2",
				durationMs: 50,
				costUsd: 0,
				usage: undefined,
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

		const { adapter } = createAdapter({ query });
		const events = [];

		for await (const event of adapter.run({ prompt: "hello" })) {
			events.push(event);
		}

		expect(events).toEqual([{ type: "error", message: "sdk boom" }]);
	});

	test("emits assistant text when no streamed text deltas were produced", async () => {
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

			const { adapter } = createAdapter({ query });
			const events = [];

			for await (const event of adapter.run({ prompt: "plot something" })) {
				events.push(event);
			}

			expect(events).toEqual([
				{
					type: "text",
					text: `Saved chart to ${imagePath}`,
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

		const { adapter } = createAdapter({ query });
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

		const tmp = mkdtempSync(join(tmpdir(), "mis-images-"));
		try {
			const imagePath = join(tmp, "cat.png");
			writeFileSync(imagePath, "image-bytes");

			const { adapter } = createAdapter({ query });

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

	test("getSkills probes once, maps descriptions, and caches the result", async () => {
		const supportedCommands = mock(async () => [
			{ name: "commit", description: "Create a git commit" },
			{ name: "review", description: "Review changes" },
		]);
		const query = mock(() => ({
			supportedCommands,
			async *[Symbol.asyncIterator]() {
				yield {
					type: "system",
					subtype: "init",
					session_id: "skill-probe-1",
					skills: ["commit"],
				};
			},
		}));
		const unlinkFile = mock(() => {});
		const { adapter } = createAdapter({
			query,
			sleep: async () => {},
			unlinkFile,
		});

		await expect(adapter.getSkills("/tmp/outclaw")).resolves.toEqual([
			{ name: "commit", description: "Create a git commit" },
		]);
		await expect(adapter.getSkills("/tmp/outclaw")).resolves.toEqual([
			{ name: "commit", description: "Create a git commit" },
		]);

		expect(query).toHaveBeenCalledTimes(1);
		expect(supportedCommands).toHaveBeenCalledTimes(1);
		expect(unlinkFile).toHaveBeenCalledTimes(1);
	});

	test("getSkills falls back to empty descriptions when supportedCommands fails", async () => {
		const supportedCommands = mock(async () => {
			throw new Error("commands unavailable");
		});
		const query = mock(() => ({
			supportedCommands,
			async *[Symbol.asyncIterator]() {
				yield {
					type: "system",
					subtype: "init",
					session_id: "skill-probe-2",
					skills: ["commit", "review"],
				};
			},
		}));
		const unlinkFile = mock(() => {});
		const { adapter } = createAdapter({
			query,
			sleep: async () => {},
			unlinkFile,
		});

		await expect(adapter.getSkills("/tmp/outclaw")).resolves.toEqual([
			{ name: "commit", description: "" },
			{ name: "review", description: "" },
		]);

		expect(query).toHaveBeenCalledTimes(1);
		expect(supportedCommands).toHaveBeenCalledTimes(1);
		expect(unlinkFile).toHaveBeenCalledTimes(1);
	});

	test("inserts line break between assistant turns (streaming)", async () => {
		const query = mock((_params: unknown) =>
			(async function* () {
				// Turn 1: text + tool use
				yield {
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "Searching" },
					},
				};
				yield {
					type: "assistant",
					message: {
						content: [
							{ type: "text", text: "Searching" },
							{ type: "tool_use", id: "t1", name: "Grep", input: {} },
						],
					},
				};
				// Turn 2: more text
				yield {
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "Found it" },
					},
				};
				yield {
					type: "assistant",
					message: {
						content: [{ type: "text", text: "Found it" }],
					},
				};
				yield {
					type: "result",
					session_id: "sdk-mt",
					duration_ms: 50,
					total_cost_usd: 0,
				};
			})(),
		);

		const { adapter } = createAdapter({ query });
		const events = [];

		for await (const event of adapter.run({ prompt: "find it" })) {
			events.push(event);
		}

		expect(events).toEqual([
			{ type: "text", text: "Searching" },
			{ type: "text", text: "\n\n" },
			{ type: "text", text: "Found it" },
			{
				type: "done",
				sessionId: "sdk-mt",
				durationMs: 50,
				costUsd: 0,
				usage: undefined,
			},
		]);
	});

	test("inserts line break between assistant turns (non-streaming)", async () => {
		const query = mock((_params: unknown) =>
			(async function* () {
				yield {
					type: "assistant",
					message: {
						content: [
							{ type: "text", text: "Searching" },
							{ type: "tool_use", id: "t1", name: "Grep", input: {} },
						],
					},
				};
				yield {
					type: "assistant",
					message: {
						content: [{ type: "text", text: "Found it" }],
					},
				};
				yield {
					type: "result",
					session_id: "sdk-mt2",
					duration_ms: 30,
					total_cost_usd: 0,
				};
			})(),
		);

		const { adapter } = createAdapter({ query });
		const events = [];

		for await (const event of adapter.run({
			prompt: "find it",
			stream: false,
		})) {
			events.push(event);
		}

		expect(events).toEqual([
			{ type: "text", text: "Searching" },
			{ type: "text", text: "\n\nFound it" },
			{
				type: "done",
				sessionId: "sdk-mt2",
				durationMs: 30,
				costUsd: 0,
				usage: undefined,
			},
		]);
	});
});
