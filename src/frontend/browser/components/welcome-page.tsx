import { type ReactNode, useEffect, useMemo } from "react";
import type { EffortLevel } from "../../../common/commands.ts";
import type { ModelAlias } from "../../../common/models.ts";
import { randomTagline } from "../../../common/taglines.ts";
import { useWs } from "../contexts/websocket-context.tsx";
import { resolveBrowserSessionKey } from "../session.ts";
import { useAgentsStore } from "../stores/agents.ts";
import { useRuntimeStore } from "../stores/runtime.ts";
import { useSessionsStore } from "../stores/sessions.ts";
import { useWorkspaceViewStore } from "../stores/workspace-view.ts";
import { resolveWelcomeAgentId } from "../welcome-agent-selection.ts";
import { MessageInput } from "./chat/message-input.tsx";
import { WelcomeAgentPicker } from "./welcome-agent-picker.tsx";

const BANNER = ` ██████╗ ██╗   ██╗████████╗ ██████╗██╗      █████╗ ██╗    ██╗
██╔═══██╗██║   ██║╚══██╔══╝██╔════╝██║     ██╔══██╗██║    ██║
██║   ██║██║   ██║   ██║   ██║     ██║     ███████║██║ █╗ ██║
██║   ██║██║   ██║   ██║   ██║     ██║     ██╔══██║██║███╗██║
╚██████╔╝╚██████╔╝   ██║   ╚██████╗███████╗██║  ██║╚███╔███╔╝
 ╚═════╝  ╚═════╝    ╚═╝    ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ `;

interface WelcomePageViewProps {
	input: ReactNode;
}

export function WelcomePageView({ input }: WelcomePageViewProps) {
	const tagline = useMemo(() => randomTagline(), []);

	return (
		<section
			aria-label="Welcome page"
			className="flex h-full items-center justify-center bg-dark-950 px-6"
		>
			<div className="w-full max-w-4xl">
				<div className="mx-auto max-w-3xl px-6 py-6">
					<div className="px-4 pb-5">
						<div className="flex justify-center">
							<pre className="font-mono font-bold leading-[1.05] text-brand text-[clamp(8px,1.4vw,16px)]">
								{BANNER}
							</pre>
						</div>
						<div className="mt-5 text-center">
							<div className="font-mono-ui text-[12px] uppercase italic tracking-[0.18em] text-ember">
								~ {tagline.toUpperCase()} ~
							</div>
						</div>
					</div>
					{input}
				</div>
			</div>
		</section>
	);
}

export function WelcomePage() {
	const { sendCommand, sendPromptToAgent } = useWs();
	const openWorkspace = useWorkspaceViewStore((state) => state.openWorkspace);
	const agents = useAgentsStore((state) => state.agents);
	const activeAgentId = useAgentsStore((state) => state.activeAgentId);
	const setActiveAgent = useAgentsStore((state) => state.setActiveAgent);
	const activeSessionByAgent = useSessionsStore(
		(state) => state.activeSessionByAgent,
	);
	const providerId = useRuntimeStore((state) => state.providerId);
	const model = useRuntimeStore((state) => state.model);
	const effort = useRuntimeStore((state) => state.effort);
	const connectionStatus = useRuntimeStore((state) => state.connectionStatus);
	const selectedAgentId = resolveWelcomeAgentId(agents, activeAgentId);

	useEffect(() => {
		if (selectedAgentId !== activeAgentId) {
			setActiveAgent(selectedAgentId);
		}
	}, [activeAgentId, selectedAgentId, setActiveAgent]);

	const selectedAgent =
		agents.find((agent) => agent.agentId === selectedAgentId) ?? null;
	const selectedSession = selectedAgentId
		? (activeSessionByAgent[selectedAgentId] ?? null)
		: null;
	const sessionKey =
		selectedAgent === null
			? null
			: resolveBrowserSessionKey({
					agentId: selectedAgent.agentId,
					activeSession: selectedSession,
					providerId,
				});

	function handleSend(prompt: string): boolean {
		if (!selectedAgent) {
			return false;
		}

		const sent = sendPromptToAgent(selectedAgent, prompt);
		if (sent) {
			openWorkspace();
		}
		return sent;
	}

	function handleModelChange(nextModel: ModelAlias) {
		return sendCommand(`/model ${nextModel}`);
	}

	function handleEffortChange(nextEffort: EffortLevel) {
		return sendCommand(`/thinking ${nextEffort}`);
	}

	return (
		<WelcomePageView
			input={
				<MessageInput
					onSend={handleSend}
					disabled={connectionStatus !== "connected" || selectedAgent === null}
					interruptible={false}
					sessionKey={sessionKey}
					model={model}
					effort={effort}
					onModelChange={handleModelChange}
					onEffortChange={handleEffortChange}
					compact
					headerSlot={
						<WelcomeAgentPicker
							agents={agents}
							onAgentChange={setActiveAgent}
							selectedAgentId={selectedAgentId}
						/>
					}
				/>
			}
		/>
	);
}
