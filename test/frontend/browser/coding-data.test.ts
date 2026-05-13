import { describe, expect, test } from "bun:test";
import type { BrowserCodingRepositorySummary } from "../../../src/common/protocol.ts";
import { createProvisionalCodingSessionSummary } from "../../../src/frontend/browser/coding/coding-data.ts";

function repo(): BrowserCodingRepositorySummary {
	return {
		id: "repo-a",
		rootCwd: "/repos/repo-a",
		displayName: "Repo A",
		source: "manual",
		status: "active",
		createdAt: 1,
		lastActive: 1,
	};
}

describe("coding data helpers", () => {
	test("creates a running provisional session summary as soon as start is accepted", () => {
		expect(
			createProvisionalCodingSessionSummary(
				repo(),
				{
					providerId: "codex",
					sdkSessionId: "session-1",
					prompt: "  implement parser  ",
				},
				30,
			),
		).toEqual({
			providerId: "codex",
			sdkSessionId: "session-1",
			repositoryId: "repo-a",
			title: "implement parser",
			model: "",
			lastActive: 30,
			cwd: "/repos/repo-a",
			lifecycleStatus: "open",
			runStatus: "running",
			createdAt: 30,
			source: "code",
			tag: "code",
		});
	});
});
