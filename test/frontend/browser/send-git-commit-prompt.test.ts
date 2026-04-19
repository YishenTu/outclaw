import { describe, expect, test } from "bun:test";
import { sendGitCommitPrompt } from "../../../src/frontend/browser/send-git-commit-prompt.ts";

describe("sendGitCommitPrompt", () => {
	test("sends the commit prompt to the selected active agent", () => {
		const calls: string[] = [];

		const sent = sendGitCommitPrompt({
			agent: { agentId: "agent-alpha", name: "alpha" },
			sendPromptToAgent: (agent, prompt) => {
				calls.push(`${agent.agentId}:${prompt}`);
				return true;
			},
		});

		expect(sent).toBe(true);
		expect(calls).toEqual([
			"agent-alpha:Commit and push the current working tree changes.",
		]);
	});

	test("does not send when there is no active agent", () => {
		const calls: string[] = [];

		const sent = sendGitCommitPrompt({
			agent: null,
			sendPromptToAgent: (_agent, prompt) => {
				calls.push(prompt);
				return true;
			},
		});

		expect(sent).toBe(false);
		expect(calls).toEqual([]);
	});
});
