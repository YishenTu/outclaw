import type { AgentEntry } from "./stores/agents.ts";

export const GIT_COMMIT_PROMPT =
	"Commit and push the current working tree changes.";

export function sendGitCommitPrompt({
	agent,
	sendPromptToAgent,
}: {
	agent: AgentEntry | null;
	sendPromptToAgent: (agent: AgentEntry, prompt: string) => boolean;
}): boolean {
	if (!agent) {
		return false;
	}

	return sendPromptToAgent(agent, GIT_COMMIT_PROMPT);
}
