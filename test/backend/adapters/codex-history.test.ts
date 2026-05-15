import { describe, expect, test } from "bun:test";
import {
	projectCodexChatDisplayMessages,
	projectCodexChatTranscriptTurns,
} from "../../../src/backend/adapters/codex/history.ts";
import type { CodingSessionEvent } from "../../../src/common/protocol.ts";

const SESSION_ID = "codex-thread-1";

function event(partial: Partial<CodingSessionEvent>): CodingSessionEvent {
	return {
		sessionId: SESSION_ID,
		...partial,
	} as CodingSessionEvent;
}

describe("projectCodexChatDisplayMessages", () => {
	test("projects user_prompt and assistant text into chat DisplayMessage[]", () => {
		const userTimestamp = Date.parse("2026-05-14T02:46:08.444Z");
		const assistantTimestamp = Date.parse("2026-05-14T02:46:11.012Z");
		const events: CodingSessionEvent[] = [
			event({
				type: "user_prompt",
				text: "hi codex",
				timestamp: userTimestamp,
			}),
			event({
				type: "thinking",
				text: "first I think... ",
				timestamp: assistantTimestamp - 1,
			}),
			event({
				type: "text",
				text: "Hello there.",
				timestamp: assistantTimestamp,
			}),
		];

		expect(projectCodexChatDisplayMessages(events)).toEqual([
			{
				kind: "chat",
				role: "user",
				content: "hi codex",
				timestamp: userTimestamp,
			},
			{
				kind: "chat",
				role: "assistant",
				content: "Hello there.",
				thinking: "first I think... ",
				timestamp: assistantTimestamp,
			},
		]);
	});

	test("drops tool/command/file-change rows from chat replay", () => {
		const events: CodingSessionEvent[] = [
			event({ type: "user_prompt", text: "fix the lint" }),
			event({
				type: "command_execution_started",
				callId: "c1",
				command: "ls",
			}),
			event({
				type: "command_execution_completed",
				callId: "c1",
				exitCode: 0,
			}),
			event({
				type: "file_change_applied",
				callId: "c1",
				changes: [],
			}),
			event({ type: "text", text: "done." }),
		];

		expect(projectCodexChatDisplayMessages(events)).toEqual([
			{ kind: "chat", role: "user", content: "fix the lint" },
			{ kind: "chat", role: "assistant", content: "done." },
		]);
	});

	test("uses the done event timestamp as the assistant completion time", () => {
		const textTimestamp = Date.parse("2026-05-14T02:46:11.012Z");
		const doneTimestamp = Date.parse("2026-05-14T02:46:12.200Z");
		const events: CodingSessionEvent[] = [
			event({ type: "user_prompt", text: "hi" }),
			event({
				type: "text",
				text: "hello",
				timestamp: textTimestamp,
			}),
			event({
				type: "done",
				durationMs: 3756,
				timestamp: doneTimestamp,
			}),
		];

		expect(projectCodexChatDisplayMessages(events)).toEqual([
			{ kind: "chat", role: "user", content: "hi" },
			{
				kind: "chat",
				role: "assistant",
				content: "hello",
				timestamp: doneTimestamp,
			},
		]);
	});
});

describe("projectCodexChatTranscriptTurns", () => {
	test("projects timestamped Codex chat events into transcript turns", () => {
		const userTimestamp = Date.parse("2026-05-14T02:46:08.444Z");
		const assistantTimestamp = Date.parse("2026-05-14T02:46:11.012Z");
		const doneTimestamp = Date.parse("2026-05-14T02:46:12.200Z");
		const events: CodingSessionEvent[] = [
			event({
				type: "user_prompt",
				text: "hi",
				timestamp: userTimestamp,
			}),
			event({
				type: "text",
				text: "hello",
				timestamp: assistantTimestamp,
			}),
			event({
				type: "done",
				durationMs: 3756,
				timestamp: doneTimestamp,
			}),
		];

		expect(projectCodexChatTranscriptTurns(events)).toEqual([
			{
				role: "user",
				content: "hi",
				timestamp: userTimestamp,
			},
			{
				role: "assistant",
				content: "hello",
				timestamp: doneTimestamp,
			},
		]);
	});

	test("returns null when the transcript has no durable timestamps", () => {
		const events: CodingSessionEvent[] = [
			event({ type: "user_prompt", text: "hi" }),
			event({ type: "text", text: "hello" }),
		];

		// Our event shapes do not currently carry timestamps; project returns
		// null so the adapter throws a clear error rather than fabricating a
		// `Date.now()` timestamp.
		expect(projectCodexChatTranscriptTurns(events)).toBeNull();
	});
});
