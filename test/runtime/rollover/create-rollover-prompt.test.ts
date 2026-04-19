import { describe, expect, test } from "bun:test";
import { createRolloverPrompt } from "../../../src/runtime/rollover/create-rollover-prompt.ts";

describe("createRolloverPrompt", () => {
	test("returns wrapper prompt instructing agent to do one final daily-note check", () => {
		expect(createRolloverPrompt()).toBe(
			"The runtime is auto-finalizing the currently active session because this agent has been idle. Check today's daily memory file one last time and write down anything notable from this session that is still missing. If you changed anything or have anything to report, summarise briefly. Otherwise reply with exactly `ROLLOVER_OK` — no other text.",
		);
	});
});
