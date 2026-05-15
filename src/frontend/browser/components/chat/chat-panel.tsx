import { LinkedCodingSessionMenuButton } from "../../coding/linked-coding-session-menu-button.tsx";
import { useWs } from "../../contexts/websocket-context.tsx";
import { useIsMobile } from "../../lib/use-is-mobile.ts";
import {
	resolveDisplayedAgentSessionKey,
	resolveDisplayedSessionTitle,
} from "../../sessions/session.ts";
import { useAgentsStore } from "../../stores/agents.ts";
import { type ChatSession, useChatStore } from "../../stores/chat.ts";
import { useRuntimeStore } from "../../stores/runtime.ts";
import { useSessionsStore } from "../../stores/sessions.ts";
import { MessageInput } from "./composer/message-input.tsx";
import { MessageList } from "./message-list.tsx";
import type { ChatModelSelection } from "./model-selector.tsx";

function hasRenderableTranscript(session: ChatSession | undefined): boolean {
	if (!session) {
		return false;
	}
	return (
		session.messages.length > 0 ||
		session.queuedPrompts.length > 0 ||
		session.streamingText !== "" ||
		session.streamingThinking !== "" ||
		session.isCompacting
	);
}

interface ChatPanelProps {
	active?: boolean;
}

export function ChatPanel({ active = true }: ChatPanelProps) {
	const { sendBrowserPrompt, sendModelSelect } = useWs();
	const isMobile = useIsMobile();
	const activeAgentId = useAgentsStore((state) => state.activeAgentId);
	const agents = useAgentsStore((state) => state.agents);
	const sessionsByAgent = useSessionsStore((state) => state.sessionsByAgent);
	const activeSession = useSessionsStore((state) =>
		activeAgentId ? (state.activeSessionByAgent[activeAgentId] ?? null) : null,
	);
	const providerId = useRuntimeStore((state) => state.providerId);
	const runtimeAgentName = useRuntimeStore((state) => state.agentName);
	const runtimeSessionId = useRuntimeStore((state) => state.sessionId);
	const sessionTitleFromRuntime = useRuntimeStore(
		(state) => state.sessionTitle,
	);
	const model = useRuntimeStore((state) => state.model);
	const effort = useRuntimeStore((state) => state.effort);
	const connectionStatus = useRuntimeStore((state) => state.connectionStatus);
	const runtimeRunning = useRuntimeStore((state) => state.running);
	const activeAgent = agents.find((agent) => agent.agentId === activeAgentId);
	const sessionKey =
		activeAgentId === null || activeAgent === undefined
			? null
			: resolveDisplayedAgentSessionKey({
					agentId: activeAgentId,
					agentName: activeAgent.name,
					activeSession,
					runtimeAgentName,
					providerId,
					runtimeSessionId,
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
	const sessionTitle = resolveDisplayedSessionTitle({
		activeSession,
		activeSessionTitle: activeSessionEntry?.title,
		agentName: activeAgent?.name ?? "",
		providerId,
		runtimeAgentName,
		runtimeSessionId,
		sessionTitleFromRuntime,
	});

	function handleModelChange(selection: ChatModelSelection) {
		return sendModelSelect(selection);
	}

	function handleEffortChange(selection: ChatModelSelection) {
		return sendModelSelect(selection);
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
					onSend={({ text, images }) => sendBrowserPrompt(text, images)}
					disabled
					interruptible={false}
					active={active}
					compact={isMobile}
					agentId={activeAgentId}
					providerId={providerId}
					model={model}
					effort={effort}
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
						<span className="truncate text-parchment">{activeAgent.name}</span>
						<span className="px-2 text-dark-700">/</span>
						<span className="truncate">{sessionTitle}</span>
					</div>
					<LinkedCodingSessionMenuButton />
				</div>
			</div>
			{chatSession?.error && (
				<div className="border-b border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
					<div className="mx-auto max-w-4xl">{chatSession.error}</div>
				</div>
			)}

			{hasRenderableTranscript(chatSession) ? (
				<MessageList
					key={sessionKey ?? "no-session"}
					sessionKey={sessionKey}
					messages={chatSession?.messages ?? []}
					queuedPrompts={chatSession?.queuedPrompts ?? []}
					streamingText={chatSession?.streamingText ?? ""}
					streamingThinking={chatSession?.streamingThinking ?? ""}
					isStreaming={chatSession?.isStreaming ?? false}
					isCompacting={chatSession?.isCompacting ?? false}
					thinkingStartedAt={chatSession?.thinkingStartedAt ?? null}
				/>
			) : (
				<div className="flex-1" />
			)}

			<MessageInput
				onSend={({ text, images }) => sendBrowserPrompt(text, images)}
				active={active}
				interruptible={
					runtimeRunning ||
					(chatSession?.isStreaming ?? false) ||
					(chatSession?.isThinking ?? false) ||
					(chatSession?.isCompacting ?? false)
				}
				sessionKey={sessionKey}
				disabled={connectionStatus !== "connected"}
				compact={isMobile}
				agentId={activeAgentId}
				providerId={providerId}
				model={model}
				effort={effort}
				onModelChange={handleModelChange}
				onEffortChange={handleEffortChange}
			/>
		</div>
	);
}
