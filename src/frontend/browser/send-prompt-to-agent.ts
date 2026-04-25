import type { ComposerImageAttachment } from "./components/chat/composer-images.ts";
import type { AgentEntry } from "./stores/agents.ts";
import type { SessionRef } from "./stores/sessions.ts";

interface SendPromptToAgentBaseParams {
	agent: AgentEntry | null;
	activeAgentId: string | null;
	runtimeAgentName: string | null;
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
	targetSession?: SessionRef | null;
	runtimeProviderId?: string | null;
	runtimeSessionId?: string | null;
	sendBrowserPrompt: (
		prompt: string,
		images: ComposerImageAttachment[],
	) => Promise<boolean>;
}

function isRuntimeSessionActive(
	targetSession: SessionRef | null | undefined,
	runtimeProviderId: string | null | undefined,
	runtimeSessionId: string | null | undefined,
): boolean {
	return (
		targetSession !== null &&
		targetSession !== undefined &&
		targetSession.providerId === runtimeProviderId &&
		targetSession.sdkSessionId === runtimeSessionId
	);
}

function activateAgentForPrompt({
	agent,
	activeAgentId,
	runtimeAgentName,
	clearRuntimeSession,
	sendCommand,
	setActiveAgent,
	setAgentName,
}: SendPromptToAgentBaseParams): boolean {
	if (!agent) {
		return false;
	}
	const runtimeMatchesAgent = runtimeAgentName === agent.name;
	if (activeAgentId !== agent.agentId || !runtimeMatchesAgent) {
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
	targetSession = null,
	runtimeProviderId = null,
	runtimeSessionId = null,
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

	if (
		targetSession &&
		!isRuntimeSessionActive(
			targetSession,
			runtimeProviderId,
			runtimeSessionId,
		) &&
		!params.sendCommand(`/session ${targetSession.sdkSessionId}`)
	) {
		return false;
	}

	return sendBrowserPrompt(trimmedPrompt, images);
}
