import { describe, expect, test } from "bun:test";
import {
	isCodingTranscriptSilentEvent,
	stripOaiMemoryCitationBlocks,
} from "../../src/common/transcript-cleanup.ts";

describe("transcript cleanup", () => {
	test("strips complete internal memory citation blocks without dropping surrounding text", () => {
		const citationBlock = [
			"<oai-mem-citation>",
			"<citation_entries>",
			"MEMORY.md:66-74|note=[recent outclaw coding UI context]",
			"</citation_entries>",
			"<rollout_ids>",
			"</rollout_ids>",
			"</oai-mem-citation>",
		].join("\n");

		expect(stripOaiMemoryCitationBlocks(citationBlock)).toBe("");
		expect(stripOaiMemoryCitationBlocks(`Done.\n\n${citationBlock}`)).toBe(
			"Done.",
		);
		expect(stripOaiMemoryCitationBlocks("literal <oai-mem-citation> tag")).toBe(
			"literal <oai-mem-citation> tag",
		);
	});

	test("classifies coding events that should not render transcript rows", () => {
		expect(isCodingTranscriptSilentEvent({ type: "usage_updated" })).toBe(true);
		expect(isCodingTranscriptSilentEvent({ type: "image" })).toBe(true);
		expect(
			isCodingTranscriptSilentEvent({
				type: "tool_call_started",
				toolKind: "write_stdin",
			}),
		).toBe(true);
		expect(
			isCodingTranscriptSilentEvent({
				type: "tool_call_completed",
				toolKind: "custom_tool_call_output",
			}),
		).toBe(true);
		expect(isCodingTranscriptSilentEvent({ type: "text", text: "keep" })).toBe(
			false,
		);
		expect(
			isCodingTranscriptSilentEvent({
				type: "tool_call_completed",
				toolKind: "view_image",
			}),
		).toBe(false);
	});
});
