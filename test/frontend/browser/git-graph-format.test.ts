import { describe, expect, test } from "bun:test";
import { formatGitGraphTooltip } from "../../../src/frontend/browser/components/right-panel/git-graph-format.ts";

describe("formatGitGraphTooltip", () => {
	test("formats compact commit metadata for hover tooltips", () => {
		expect(
			formatGitGraphTooltip({
				sha: "86419c2f4e2a0d18d4f9eb1c620f20ec7f94c8b1",
				commit: {
					author: {
						name: "Yishen Tu",
						date: "2026-04-17T00:00:00.000Z",
					},
					message: "Stop tracking .env",
				},
				parents: [],
			}),
		).toBe("86419c2  Yishen Tu  Apr 17, 2026");
	});
});
