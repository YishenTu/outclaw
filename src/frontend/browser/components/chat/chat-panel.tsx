import type { EffortLevel } from "../../../../common/commands.ts";
import type { ModelAlias } from "../../../../common/models.ts";
import { useWs } from "../../contexts/websocket-context.tsx";
import { resolveBrowserSessionKey } from "../../session.ts";
import { useAgentsStore } from "../../stores/agents.ts";
import { useChatStore } from "../../stores/chat.ts";
import { useRuntimeStore } from "../../stores/runtime.ts";
import { useSessionsStore } from "../../stores/sessions.ts";
import { MessageInput } from "./message-input.tsx";
import { MessageList } from "./message-list.tsx";

export function ChatPanel() {
	const { sendCommand, sendPrompt } = useWs();
	const activeAgentId = useAgentsStore((state) => state.activeAgentId);
	const agents = useAgentsStore((state) => state.agents);
	const sessionsByAgent = useSessionsStore((state) => state.sessionsByAgent);
	const activeSession = useSessionsStore((state) =>
		activeAgentId ? (state.activeSessionByAgent[activeAgentId] ?? null) : null,
	);
	const runtime = useRuntimeStore((state) => state);
	const activeAgent = agents.find((agent) => agent.agentId === activeAgentId);
	const sessionKey =
		activeAgentId === null
			? null
			: resolveBrowserSessionKey({
					agentId: activeAgentId,
					activeSession,
					providerId: runtime.providerId,
				});
	const chatSession = useChatStore((state) =>
		sessionKey ? state.sessions[sessionKey] : undefined,
	);
	const activeSessionEntry =
		activeAgentId && activeSession
			? (sessionsByAgent[activeAgentId] ?? []).find(
					(session) =>
						session.providerId === activeSession.providerId &&
						session.sdkSessionId === activeSession.sdkSessionId,
				)
			: undefined;
	const sessionTitle =
		runtime.sessionTitle ??
		activeSessionEntry?.title ??
		(activeSession ? activeSession.sdkSessionId : "New conversation");

	function handleModelChange(model: ModelAlias) {
		return sendCommand(`/model ${model}`);
	}

	function handleEffortChange(effort: EffortLevel) {
		return sendCommand(`/thinking ${effort}`);
	}

	if (!activeAgentId || !activeAgent) {
		return (
			<div className="flex h-full flex-col bg-dark-950">
				<div className="flex flex-1 items-center justify-center px-6">
					<div className="border border-dashed border-dark-800 px-6 py-5 text-center">
						<div className="font-mono-ui text-[12px] uppercase tracking-[0.18em] text-dark-500">
							No active agent
						</div>
						<div className="mt-3 text-sm text-dark-400">
							Once the runtime attaches, the center pane will stream the same
							chat content as TUI.
						</div>
					</div>
				</div>
				<MessageInput
					onSend={sendPrompt}
					disabled
					interruptible={false}
					model={runtime.model}
					effort={runtime.effort}
					onModelChange={handleModelChange}
					onEffortChange={handleEffortChange}
				/>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col bg-dark-950">
			<div className="h-8 shrink-0 border-b border-dark-800 px-6">
				<div className="mx-auto flex h-full max-w-4xl items-center gap-4">
					<div className="min-w-0 font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
						<span className="truncate text-dark-300">{activeAgent.name}</span>
						<span className="px-2 text-dark-700">/</span>
						<span className="truncate">{sessionTitle}</span>
					</div>
				</div>
			</div>

			{chatSession?.error && (
				<div className="border-b border-red-500/20 bg-red-500/10 px-6 py-3 text-sm text-red-200">
					<div className="mx-auto max-w-4xl">{chatSession.error}</div>
				</div>
			)}

			{(chatSession?.messages.length ?? 0) === 0 &&
			(chatSession?.streamingText ?? "") === "" &&
			(chatSession?.streamingThinking ?? "") === "" ? (
				<div className="flex-1" />
			) : (
				<MessageList
					messages={chatSession?.messages ?? []}
					streamingText={chatSession?.streamingText ?? ""}
					streamingThinking={chatSession?.streamingThinking ?? ""}
					isStreaming={chatSession?.isStreaming ?? false}
					isCompacting={chatSession?.isCompacting ?? false}
					thinkingStartedAt={chatSession?.thinkingStartedAt ?? null}
				/>
			)}

			<MessageInput
				onSend={sendPrompt}
				interruptible={
					(chatSession?.isStreaming ?? false) ||
					(chatSession?.isThinking ?? false) ||
					(chatSession?.isCompacting ?? false)
				}
				sessionKey={sessionKey}
				disabled={runtime.connectionStatus !== "connected"}
				model={runtime.model}
				effort={runtime.effort}
				onModelChange={handleModelChange}
				onEffortChange={handleEffortChange}
			/>
		</div>
	);
}
