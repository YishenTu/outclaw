import { describe, expect, test } from "bun:test";
import { createHeartbeatPrompt } from "../../../src/runtime/heartbeat/create-heartbeat-prompt.ts";

describe("createHeartbeatPrompt", () => {
	test("returns wrapper prompt instructing agent to read HEARTBEAT.md", () => {
		expect(createHeartbeatPrompt("/tmp/home")).toBe(
			"Read HEARTBEAT.md and follow its instructions. Only act on what the file currently says — do not repeat tasks from earlier heartbeats or infer tasks from conversation history. If the file is missing or nothing needs attention, reply only `HEARTBEAT_OK`, no explaination.",
		);
	});
});
