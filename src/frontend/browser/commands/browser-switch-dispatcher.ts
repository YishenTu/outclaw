import { formatProviderSessionRef } from "../../../common/provider-session-ref.ts";
import type { SessionEntry } from "../stores/sessions.ts";

interface BrowserSwitchDispatcherParams {
	getRuntimeAgentName: () => string | null;
	sendCommand: (command: string) => boolean;
}

export interface BrowserSwitchDispatcher {
	switchAgent: (agentName: string) => boolean;
	switchSession: (agentName: string, session: SessionEntry) => boolean;
}

export function createBrowserSwitchDispatcher({
	getRuntimeAgentName,
	sendCommand,
}: BrowserSwitchDispatcherParams): BrowserSwitchDispatcher {
	return {
		switchAgent: (agentName) => sendCommand(`/agent ${agentName}`),
		switchSession: (agentName, session) => {
			if (
				getRuntimeAgentName() !== agentName &&
				!sendCommand(`/agent ${agentName}`)
			) {
				return false;
			}

			return sendCommand(`/session ${formatSessionRef(session)}`);
		},
	};
}

function formatSessionRef(session: SessionEntry): string {
	return formatProviderSessionRef(session);
}
