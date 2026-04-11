import { describe, expect, mock, test } from "bun:test";

function mockClaudeSdk(
	overrides: {
		query?: ReturnType<typeof mock>;
		getSessionMessages?: ReturnType<typeof mock>;
	} = {},
) {
	const query = overrides.query ?? mock(() => (async function* () {})());
	const getSessionMessages =
		overrides.getSessionMessages ?? mock(async () => []);
	mock.module("@anthropic-ai/claude-agent-sdk", () => ({
		query,
		getSessionMessages,
	}));
	return { query, getSessionMessages };
}

describe("readHistory", () => {
	test("returns displayable user and assistant messages", async () => {
		const getSessionMessages = mock(async (sessionId: string) => {
			expect(sessionId).toBe("sdk-123");
			return [
				{
					type: "user",
					message: { content: "hello" },
				},
				{
					type: "assistant",
					message: {
						content: [
							{ type: "text", text: "hi" },
							{ type: "tool_use", text: "skip" },
							{ type: "text", text: " there" },
						],
					},
				},
				{
					type: "user",
					message: { content: [{ type: "tool_result", text: "skip" }] },
				},
				{
					type: "assistant",
					message: {
						content: [{ type: "tool_use", text: "skip" }],
					},
				},
			];
		});

		mockClaudeSdk({ getSessionMessages });

		const { readHistory } = await import(
			"../../../src/runtime/persistence/history-reader.ts"
		);
		const messages = await readHistory("sdk-123");

		expect(messages).toEqual([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		]);
	});

	test("merges separate thinking and text assistant entries", async () => {
		const getSessionMessages = mock(async () => [
			{
				type: "user",
				message: { content: "hello" },
			},
			{
				type: "assistant",
				message: {
					content: [{ type: "thinking", thinking: "let me reason" }],
				},
			},
			{
				type: "assistant",
				message: {
					content: [{ type: "text", text: "the answer" }],
				},
			},
		]);

		mockClaudeSdk({ getSessionMessages });

		const { readHistory } = await import(
			"../../../src/runtime/persistence/history-reader.ts"
		);
		const messages = await readHistory("sdk-merge");

		expect(messages).toEqual([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "the answer", thinking: "let me reason" },
		]);
	});

	test("concatenates consecutive thinking-only assistant entries before text", async () => {
		const getSessionMessages = mock(async () => [
			{
				type: "assistant",
				message: {
					content: [{ type: "thinking", thinking: "let me " }],
				},
			},
			{
				type: "assistant",
				message: {
					content: [{ type: "thinking", thinking: "reason" }],
				},
			},
			{
				type: "assistant",
				message: {
					content: [{ type: "text", text: "the answer" }],
				},
			},
		]);

		mockClaudeSdk({ getSessionMessages });

		const { readHistory } = await import(
			"../../../src/runtime/persistence/history-reader.ts"
		);
		const messages = await readHistory("sdk-consecutive");

		expect(messages).toEqual([
			{
				role: "assistant",
				content: "the answer",
				thinking: "let me reason",
			},
		]);
	});

	test("handles thinking followed by tool_use then text in next turn", async () => {
		const getSessionMessages = mock(async () => [
			{
				type: "assistant",
				message: {
					content: [{ type: "thinking", thinking: "reasoning" }],
				},
			},
			{
				type: "assistant",
				message: {
					content: [{ type: "text", text: "searching..." }],
				},
			},
			{
				type: "assistant",
				message: {
					content: [{ type: "tool_use", id: "t1", name: "Grep", input: {} }],
				},
			},
			{
				type: "user",
				message: {
					content: [{ type: "tool_result", text: "results" }],
				},
			},
			{
				type: "assistant",
				message: {
					content: [{ type: "thinking", thinking: "now I know" }],
				},
			},
			{
				type: "assistant",
				message: {
					content: [{ type: "text", text: "found it" }],
				},
			},
		]);

		mockClaudeSdk({ getSessionMessages });

		const { readHistory } = await import(
			"../../../src/runtime/persistence/history-reader.ts"
		);
		const messages = await readHistory("sdk-multi");

		expect(messages).toEqual([
			{ role: "assistant", content: "searching...", thinking: "reasoning" },
			{ role: "assistant", content: "found it", thinking: "now I know" },
		]);
	});

	test("flushes pending thinking before a new user turn", async () => {
		const getSessionMessages = mock(async () => [
			{
				type: "assistant",
				message: {
					content: [{ type: "thinking", thinking: "unfinished reasoning" }],
				},
			},
			{
				type: "user",
				message: { content: "new prompt" },
			},
			{
				type: "assistant",
				message: {
					content: [{ type: "text", text: "new answer" }],
				},
			},
		]);

		mockClaudeSdk({ getSessionMessages });

		const { readHistory } = await import(
			"../../../src/runtime/persistence/history-reader.ts"
		);
		const messages = await readHistory("sdk-user-boundary");

		expect(messages).toEqual([
			{
				role: "assistant",
				content: "",
				thinking: "unfinished reasoning",
			},
			{ role: "user", content: "new prompt" },
			{ role: "assistant", content: "new answer" },
		]);
	});

	test("preserves multimodal user prompts in replayable form", async () => {
		const getSessionMessages = mock(async () => [
			{
				type: "user",
				message: {
					content: [
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/png",
								data: "abc123",
							},
						},
						{ type: "text", text: "describe this" },
					],
				},
			},
			{
				type: "assistant",
				message: {
					content: [{ type: "text", text: "It is a cat." }],
				},
			},
		]);

		mockClaudeSdk({ getSessionMessages });

		const { readHistory } = await import(
			"../../../src/runtime/persistence/history-reader.ts"
		);
		const messages = await readHistory("sdk-456");

		expect(messages).toEqual([
			{
				role: "user",
				content: "describe this",
				images: [{ mediaType: "image/png" }],
			},
			{ role: "assistant", content: "It is a cat." },
		]);
	});
});
