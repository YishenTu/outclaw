import { describe, expect, test } from "bun:test";
import { createHeartbeatPrompt } from "../../../src/runtime/heartbeat/create-heartbeat-prompt.ts";

describe("createHeartbeatPrompt", () => {
	test("returns wrapper prompt instructing agent to read HEARTBEAT.md", () => {
		expect(createHeartbeatPrompt("/tmp/home")).toBe(
			"Read HEARTBEAT.md and follow its instructions. Only act on what the file currently says — do not repeat tasks from earlier heartbeats or infer tasks from conversation history. If you took any action or have anything to report, summarise briefly. If you did nothing and have nothing to notify the user about, reply with exactly `HEARTBEAT_OK` — no other text.",
		);
	});
});
