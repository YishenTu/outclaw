import { describe, expect, test } from "bun:test";
import {
	formatSearchTranscriptTurnBody,
	formatTranscriptTurnBody,
} from "../../src/common/transcript-turn-body.ts";

describe("formatTranscriptTurnBody", () => {
	test("combines reply context and content into a searchable/display body", () => {
		expect(
			formatTranscriptTurnBody({
				role: "user",
				content: "follow up question",
				replyContext: { text: "quoted line" },
				timestamp: 1,
			}),
		).toBe("> quoted line\nfollow up question");
	});

	test("omits image placeholders unless explicitly requested", () => {
		const turn = {
			role: "user" as const,
			content: "",
			images: [{ mediaType: "image/png" as const }],
			timestamp: 1,
		};

		expect(formatTranscriptTurnBody(turn)).toBe("");
		expect(
			formatTranscriptTurnBody(turn, {
				includeImagePlaceholders: true,
			}),
		).toBe("[images: 1]");
	});

	test("search formatting filters exact operational heartbeat prompts and bare HEARTBEAT_OK replies", () => {
		expect(
			formatSearchTranscriptTurnBody({
				role: "user",
				content:
					"Read HEARTBEAT.md and follow its instructions. Only act on what the file currently says — do not repeat tasks from earlier heartbeats or infer tasks from conversation history. If you took any action or have anything to report, summarise briefly. If you did nothing and have nothing to notify the user about, reply with exactly `HEARTBEAT_OK` — no other text.",
				timestamp: 1,
			}),
		).toBe("");
		expect(
			formatSearchTranscriptTurnBody({
				role: "assistant",
				content: "`HEARTBEAT_OK`",
				timestamp: 2,
			}),
		).toBe("");
	});

	test("search formatting keeps substantive heartbeat discussion", () => {
		expect(
			formatSearchTranscriptTurnBody({
				role: "user",
				content:
					"Read HEARTBEAT.md and follow its instructions. Only act on what the file currently says — do not repeat tasks from earlier heartbeats or infer tasks from conversation history.\n\nlooking at the injected prompt, maybe we should clarify that as well?",
				timestamp: 1,
			}),
		).toContain("looking at the injected prompt");
		expect(
			formatSearchTranscriptTurnBody({
				role: "assistant",
				content: "Updated daily memory with the heartbeat prompt revision.",
				timestamp: 2,
			}),
		).toBe("Updated daily memory with the heartbeat prompt revision.");
	});
});
