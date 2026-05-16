import { describe, expect, test } from "bun:test";
import type {
	DisplayMessage,
	TranscriptTurn,
} from "../../src/common/protocol.ts";
import { annotateHistoryWithTranscript } from "../../src/common/replay-history.ts";

function chat(
	role: "user" | "assistant",
	content: string,
	overrides: { replyText?: string } = {},
): DisplayMessage {
	return {
		kind: "chat",
		role,
		content,
		...(overrides.replyText
			? { replyContext: { text: overrides.replyText } }
			: {}),
	};
}

function turn(
	role: "user" | "assistant",
	content: string,
	timestamp: number,
	overrides: { replyText?: string } = {},
): TranscriptTurn {
	return {
		role,
		content,
		timestamp,
		...(overrides.replyText
			? { replyContext: { text: overrides.replyText } }
			: {}),
	};
}

describe("annotateHistoryWithTranscript", () => {
	test("returns messages untouched when transcript is empty", () => {
		const messages = [chat("user", "hi"), chat("assistant", "hello")];
		expect(annotateHistoryWithTranscript(messages, [])).toEqual(messages);
	});

	test("returns messages untouched when transcript is undefined", () => {
		const messages = [chat("user", "hi")];
		expect(annotateHistoryWithTranscript(messages, undefined)).toEqual(
			messages,
		);
	});

	test("annotates chat messages with timestamps in order", () => {
		const messages = [
			chat("user", "hello"),
			chat("assistant", "hi there"),
			chat("user", "bye"),
		];
		const transcript = [
			turn("user", "hello", 100),
			turn("assistant", "hi there", 200),
			turn("user", "bye", 300),
		];
		const annotated = annotateHistoryWithTranscript(messages, transcript);
		expect(
			annotated.map((m) => (m.kind === "chat" ? m.timestamp : null)),
		).toEqual([100, 200, 300]);
	});

	test("skips messages with no matching transcript turn", () => {
		const messages = [
			chat("user", "hello"),
			chat("user", "missing"),
			chat("assistant", "reply"),
		];
		const transcript = [
			turn("user", "hello", 100),
			turn("assistant", "reply", 200),
		];
		const annotated = annotateHistoryWithTranscript(messages, transcript);
		expect(
			annotated.map((m) => (m.kind === "chat" ? m.timestamp : null)),
		).toEqual([100, undefined, 200]);
	});

	test("matches duplicate consecutive messages to successive turns", () => {
		const messages = [chat("user", "ping"), chat("user", "ping")];
		const transcript = [turn("user", "ping", 1), turn("user", "ping", 2)];
		const annotated = annotateHistoryWithTranscript(messages, transcript);
		expect(
			annotated.map((m) => (m.kind === "chat" ? m.timestamp : null)),
		).toEqual([1, 2]);
	});

	test("matching is forward-only; later message cannot bind to earlier turn", () => {
		const messages = [chat("user", "second"), chat("user", "first")];
		const transcript = [
			turn("user", "first", 1),
			turn("user", "second", 2),
			turn("user", "third", 3),
		];
		const annotated = annotateHistoryWithTranscript(messages, transcript);
		expect(
			annotated.map((m) => (m.kind === "chat" ? m.timestamp : null)),
		).toEqual([2, undefined]);
	});

	test("reply context disambiguates otherwise-identical turns", () => {
		const messages = [
			chat("user", "ok", { replyText: "first" }),
			chat("user", "ok", { replyText: "second" }),
		];
		const transcript = [
			turn("user", "ok", 1, { replyText: "first" }),
			turn("user", "ok", 2, { replyText: "second" }),
		];
		const annotated = annotateHistoryWithTranscript(messages, transcript);
		expect(
			annotated.map((m) => (m.kind === "chat" ? m.timestamp : null)),
		).toEqual([1, 2]);
	});

	test("does not confuse turns when whitespace straddles reply context and content", () => {
		const transcript = [
			turn("user", "b c", 1, { replyText: "a" }),
			turn("user", "c", 2, { replyText: "a b" }),
		];
		const messages = [
			chat("user", "c", { replyText: "a b" }),
			chat("user", "b c", { replyText: "a" }),
		];
		const annotated = annotateHistoryWithTranscript(messages, transcript);
		expect(
			annotated.map((m) => (m.kind === "chat" ? m.timestamp : null)),
		).toEqual([2, undefined]);
	});

	test("non-chat messages are passed through untouched", () => {
		const messages: DisplayMessage[] = [
			chat("user", "hi"),
			{ kind: "system", event: "status", text: "ok" },
			chat("assistant", "yo"),
		];
		const transcript = [turn("user", "hi", 10), turn("assistant", "yo", 20)];
		const annotated = annotateHistoryWithTranscript(messages, transcript);
		expect(annotated[1]).toEqual(messages[1] as DisplayMessage);
		expect(
			annotated.map((m) => (m.kind === "chat" ? m.timestamp : "skip")),
		).toEqual([10, "skip", 20]);
	});

	test("handles large transcripts correctly when most messages miss", () => {
		const transcript: TranscriptTurn[] = [];
		for (let i = 0; i < 2000; i += 1) {
			transcript.push(turn("user", `t${i}`, i));
		}
		const messages: DisplayMessage[] = [];
		for (let i = 0; i < 50; i += 1) {
			messages.push(chat("user", `nope-${i}`));
		}
		messages.push(chat("user", "t1500"));
		const annotated = annotateHistoryWithTranscript(messages, transcript);
		const last = annotated.at(-1);
		expect(last?.kind).toBe("chat");
		expect(last?.kind === "chat" ? last.timestamp : null).toBe(1500);
		for (let i = 0; i < 50; i += 1) {
			const message = annotated[i];
			expect(
				message?.kind === "chat" ? message.timestamp : "skip",
			).toBeUndefined();
		}
	});
});
