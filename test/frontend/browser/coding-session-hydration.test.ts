import { describe, expect, test } from "bun:test";
import { shouldHydrateCodingSessionEvents } from "../../../src/frontend/browser/coding/coding-session-hydration.ts";

describe("coding session hydration policy", () => {
	test("hydrates missing transcripts but keeps cached idle sessions in memory", () => {
		expect(
			shouldHydrateCodingSessionEvents({
				cachedEventCount: 0,
				runStatus: "idle",
			}),
		).toBe(true);
		expect(
			shouldHydrateCodingSessionEvents({
				cachedEventCount: 3,
				runStatus: "idle",
			}),
		).toBe(false);
		expect(
			shouldHydrateCodingSessionEvents({
				cachedEventCount: 3,
				runStatus: "running",
			}),
		).toBe(true);
	});
});
