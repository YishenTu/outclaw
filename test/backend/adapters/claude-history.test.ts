import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ClaudeHistoryMessage,
	readClaudeHistory,
} from "../../../src/backend/adapters/claude-history.ts";

const MISSING_PROJECTS_DIR = join(tmpdir(), "outclaw-no-history-here");

function readSdkHistory(
	messages: ClaudeHistoryMessage[],
	sessionId = "sdk-test",
) {
	const loadHistory = mock(async (requestedSessionId: string) => {
		expect(requestedSessionId).toBe(sessionId);
		return messages;
	});

	const result = readClaudeHistory({
		sessionId,
		loadHistory,
		claudeProjectsDir: MISSING_PROJECTS_DIR,
	});

	return {
		loadHistory,
		result,
	};
}

describe("readClaudeHistory", () => {
	test("prefers the raw Claude JSONL transcript before falling back to SDK history", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "outclaw-claude-history-module-"));
		const projectsDir = join(tmp, "projects");
		const projectDir = join(projectsDir, "sample-project");
		const sessionId = "sdk-full-history";

		try {
			mkdirSync(projectDir, { recursive: true });
			writeFileSync(
				join(projectDir, `${sessionId}.jsonl`),
				[
					JSON.stringify({
						type: "user",
						message: {
							content: [{ type: "text", text: "hello before compact" }],
						},
					}),
					JSON.stringify({
						type: "assistant",
						message: {
							content: [{ type: "text", text: "answer before compact" }],
						},
					}),
				].join("\n"),
			);

			const loadHistory = mock(async () => [
				{
					type: "user",
					message: { content: "sdk-only question" },
				},
				{
					type: "assistant",
					message: {
						content: [{ type: "text", text: "sdk-only answer" }],
					},
				},
			]);

			const messages = await readClaudeHistory({
				sessionId,
				loadHistory,
				claudeProjectsDir: projectsDir,
			});

			expect(loadHistory).not.toHaveBeenCalled();
			expect(messages).toEqual([
				{ kind: "chat", role: "user", content: "hello before compact" },
				{
					kind: "chat",
					role: "assistant",
					content: "answer before compact",
				},
			]);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("falls back to SDK history when the raw JSONL transcript is unavailable", async () => {
		const loadHistory = mock(async () => [
			{
				type: "user",
				message: { content: "sdk-only question" },
			},
			{
				type: "assistant",
				message: {
					content: [{ type: "text", text: "sdk-only answer" }],
				},
			},
		]);

		const messages = await readClaudeHistory({
			sessionId: "missing-session",
			loadHistory,
			claudeProjectsDir: MISSING_PROJECTS_DIR,
		});

		expect(loadHistory).toHaveBeenCalledWith("missing-session", {
			includeSystemMessages: true,
		});
		expect(messages).toEqual([
			{ kind: "chat", role: "user", content: "sdk-only question" },
			{
				kind: "chat",
				role: "assistant",
				content: "sdk-only answer",
			},
		]);
	});

	test("returns displayable user and assistant messages", async () => {
		const { result } = readSdkHistory(
			[
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
			],
			"sdk-123",
		);

		expect(await result).toEqual([
			{ kind: "chat", role: "user", content: "hello" },
			{ kind: "chat", role: "assistant", content: "hi there" },
		]);
	});

	test("merges separate thinking and text assistant entries", async () => {
		const { result } = readSdkHistory([
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

		expect(await result).toEqual([
			{ kind: "chat", role: "user", content: "hello" },
			{
				kind: "chat",
				role: "assistant",
				content: "the answer",
				thinking: "let me reason",
			},
		]);
	});

	test("concatenates consecutive thinking-only assistant entries before text", async () => {
		const { result } = readSdkHistory([
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

		expect(await result).toEqual([
			{
				kind: "chat",
				role: "assistant",
				content: "the answer",
				thinking: "let me reason",
			},
		]);
	});

	test("handles thinking followed by tool_use then text in next turn", async () => {
		const { result } = readSdkHistory([
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

		expect(await result).toEqual([
			{
				kind: "chat",
				role: "assistant",
				content: "searching...",
				thinking: "reasoning",
			},
			{
				kind: "chat",
				role: "assistant",
				content: "found it",
				thinking: "now I know",
			},
		]);
	});

	test("flushes pending thinking before a new user turn", async () => {
		const { result } = readSdkHistory([
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

		expect(await result).toEqual([
			{
				kind: "chat",
				role: "assistant",
				content: "",
				thinking: "unfinished reasoning",
			},
			{ kind: "chat", role: "user", content: "new prompt" },
			{ kind: "chat", role: "assistant", content: "new answer" },
		]);
	});

	test("preserves multimodal user prompts in replayable form", async () => {
		const { result } = readSdkHistory([
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

		expect(await result).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "describe this",
				images: [{ mediaType: "image/png" }],
			},
			{ kind: "chat", role: "assistant", content: "It is a cat." },
		]);
	});

	test("strips reply-context envelopes from replayed user prompts", async () => {
		const { result } = readSdkHistory([
			{
				type: "user",
				message: {
					content:
						"what do you mean?\n\n<reply-context>the &quot;cron&quot; output &lt;ok&gt;</reply-context>",
				},
			},
			{
				type: "assistant",
				message: {
					content: [{ type: "text", text: "I mean the nightly summary." }],
				},
			},
		]);

		expect(await result).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "what do you mean?",
				replyContext: { text: 'the "cron" output <ok>' },
			},
			{
				kind: "chat",
				role: "assistant",
				content: "I mean the nightly summary.",
			},
		]);
	});
});
