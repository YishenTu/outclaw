import type { ComposerImageAttachment } from "./components/chat/composer-images.ts";
import type { AgentEntry } from "./stores/agents.ts";

interface SendPromptToAgentBaseParams {
	agent: AgentEntry | null;
	activeAgentId: string | null;
	clearRuntimeSession: () => void;
	sendCommand: (command: string) => boolean;
	setActiveAgent: (agentId: string) => void;
	setAgentName: (name: string | null) => void;
}

interface SendPromptToAgentParams extends SendPromptToAgentBaseParams {
	prompt: string;
	sendPrompt: (prompt: string) => boolean;
}

interface SendBrowserPromptToAgentParams extends SendPromptToAgentBaseParams {
	prompt: string;
	images: ComposerImageAttachment[];
	sendBrowserPrompt: (
		prompt: string,
		images: ComposerImageAttachment[],
	) => Promise<boolean>;
}

function activateAgentForPrompt({
	agent,
	activeAgentId,
	clearRuntimeSession,
	sendCommand,
	setActiveAgent,
	setAgentName,
}: SendPromptToAgentBaseParams): boolean {
	if (!agent) {
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

	return true;
}

export function sendPromptToAgent({
	prompt,
	sendPrompt,
	...params
}: SendPromptToAgentParams): boolean {
	const trimmedPrompt = prompt.trim();
	if (trimmedPrompt === "") {
		return false;
	}

	if (!activateAgentForPrompt(params)) {
		return false;
	}

	return sendPrompt(trimmedPrompt);
}

export async function sendBrowserPromptToAgent({
	prompt,
	images,
	sendBrowserPrompt,
	...params
}: SendBrowserPromptToAgentParams): Promise<boolean> {
	const trimmedPrompt = prompt.trim();
	if (trimmedPrompt === "" && images.length === 0) {
		return false;
	}

	if (!activateAgentForPrompt(params)) {
		return false;
	}

	return sendBrowserPrompt(trimmedPrompt, images);
}
