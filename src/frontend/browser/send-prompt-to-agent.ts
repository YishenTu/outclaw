import type { AgentEntry } from "./stores/agents.ts";

interface SendPromptToAgentParams {
	agent: AgentEntry | null;
	activeAgentId: string | null;
	clearRuntimeSession: () => void;
	prompt: string;
	sendCommand: (command: string) => boolean;
	sendPrompt: (prompt: string) => boolean;
	setActiveAgent: (agentId: string) => void;
	setAgentName: (name: string | null) => void;
}

export function sendPromptToAgent({
	agent,
	activeAgentId,
	clearRuntimeSession,
	prompt,
	sendCommand,
	sendPrompt,
	setActiveAgent,
	setAgentName,
}: SendPromptToAgentParams): boolean {
	const trimmedPrompt = prompt.trim();
	if (!agent || trimmedPrompt === "") {
		return false;
	}

	if (activeAgentId !== agent.agentId) {
		if (!sendCommand(`/agent ${agent.name}`)) {
			return false;
		}

		setActiveAgent(agent.agentId);
		setAgentName(agent.name);
		clearRuntimeSession();
	}

	return sendPrompt(trimmedPrompt);
}
