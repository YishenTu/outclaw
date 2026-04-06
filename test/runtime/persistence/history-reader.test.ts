import { describe, expect, mock, test } from "bun:test";

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
							{ type: "thinking", text: "hidden" },
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

		mock.module("@anthropic-ai/claude-agent-sdk", () => ({
			getSessionMessages,
		}));

		const { readHistory } = await import(
			"../../../src/runtime/persistence/history-reader.ts"
		);
		const messages = await readHistory("sdk-123");

		expect(messages).toEqual([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		]);
	});
});
