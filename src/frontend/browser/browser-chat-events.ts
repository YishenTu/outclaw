import type { ImageRef, ServerEvent } from "../../common/protocol.ts";
import { ensureRunningChatSession } from "./ensure-running-chat-session.ts";
import { toObservedDisplayMessage } from "./observed-prompt.ts";
import { createBrowserSessionRef, createSessionKey } from "./session.ts";
import { useChatStore } from "./stores/chat.ts";
import { useContextUsageStore } from "./stores/context-usage.ts";
import { useRuntimeStore } from "./stores/runtime.ts";
import { useSessionsStore } from "./stores/sessions.ts";

type SessionKey = string;

export interface LiveRunCompletion {
	adoptFromSessionKey?: SessionKey;
	sessionKey: SessionKey;
}

export interface BrowserChatEventHandlerOptions {
	clearLiveRunSessions: () => void;
	completeLiveRunSession: (
		nextSessionKey: SessionKey,
		currentSessionKey: SessionKey,
	) => LiveRunCompletion;
	getActiveAgentId: () => string | null;
	getCurrentSessionKey: (agentId: string) => SessionKey;
	pinObservedSessionKey: (
		agentId: string,
		observedSessionId?: string,
	) => SessionKey;
	refreshSidebar: () => void;
	routeObservedSessionKey: (
		agentId: string,
		observedSessionId?: string,
	) => SessionKey;
}

export function applyBrowserChatEvent(
	event: ServerEvent,
	options: BrowserChatEventHandlerOptions,
): boolean {
	switch (event.type) {
		case "history_replay": {
			const agentId = options.getActiveAgentId();
			const runtime = useRuntimeStore.getState();
			const providerId = runtime.providerId;
			if (!agentId || !providerId) {
				return true;
			}

			useChatStore
				.getState()
				.replaceHistory(
					createSessionKey(
						createBrowserSessionRef(agentId, providerId, event.sdkSessionId),
					),
					event.messages,
					{
						preservePendingTurn:
							runtime.running &&
							runtime.sessionId === event.sdkSessionId &&
							runtime.providerId === providerId,
					},
				);
			if (runtime.running) {
				ensureRunningChatSession(agentId, runtime.providerId);
			}
			return true;
		}
		case "streaming_sync": {
			const agentId = options.getActiveAgentId();
			const providerId = useRuntimeStore.getState().providerId;
			if (!agentId || !providerId) {
				return true;
			}

			const sessionKey = createSessionKey(
				createBrowserSessionRef(agentId, providerId, event.sdkSessionId),
			);
			useChatStore.getState().restoreStreamingState(sessionKey, {
				images: event.images,
				text: event.text,
				thinking: event.thinking,
			});
			return true;
		}
		case "user_prompt": {
			const agentId = options.getActiveAgentId();
			if (!agentId) {
				return true;
			}
			const sessionKey = options.pinObservedSessionKey(
				agentId,
				event.sessionId,
			);
			const message = toObservedDisplayMessage(event);
			if (!message) {
				return true;
			}

			useChatStore.getState().pushMessage(
				sessionKey,
				message.kind === "chat"
					? {
							...message,
							timestamp: Date.now(),
						}
					: message,
			);
			return true;
		}
		case "thinking": {
			const agentId = options.getActiveAgentId();
			if (!agentId) {
				return true;
			}
			useChatStore
				.getState()
				.appendThinking(
					options.routeObservedSessionKey(agentId, event.sessionId),
					event.text,
				);
			return true;
		}
		case "text": {
			const agentId = options.getActiveAgentId();
			if (!agentId) {
				return true;
			}
			useChatStore
				.getState()
				.appendText(
					options.routeObservedSessionKey(agentId, event.sessionId),
					event.text,
				);
			return true;
		}
		case "image": {
			const agentId = options.getActiveAgentId();
			if (!agentId) {
				return true;
			}
			useChatStore
				.getState()
				.appendImage(
					options.routeObservedSessionKey(agentId, event.sessionId),
					{
						kind: "managed",
						path: event.path,
						mediaType:
							event.mediaType ??
							inferImageMediaTypeFromPath(event.path) ??
							"image/png",
					},
				);
			return true;
		}
		case "compacting_started": {
			const agentId = options.getActiveAgentId();
			if (!agentId) {
				return true;
			}
			useChatStore
				.getState()
				.setCompacting(
					options.routeObservedSessionKey(agentId, event.sessionId),
					true,
				);
			return true;
		}
		case "compacting_finished": {
			const agentId = options.getActiveAgentId();
			if (!agentId) {
				return true;
			}
			useChatStore
				.getState()
				.setCompacting(
					options.routeObservedSessionKey(agentId, event.sessionId),
					false,
				);
			return true;
		}
		case "done": {
			const agentId = options.getActiveAgentId();
			if (!agentId) {
				return true;
			}

			const currentSessionKey = options.getCurrentSessionKey(agentId);
			const providerId = useRuntimeStore.getState().providerId;
			if (!providerId) {
				return true;
			}
			const nextSessionRef = createBrowserSessionRef(
				agentId,
				providerId,
				event.sessionId,
			);
			const nextSessionKey = createSessionKey(nextSessionRef);
			const completion = options.completeLiveRunSession(
				nextSessionKey,
				currentSessionKey,
			);

			if (
				completion.adoptFromSessionKey &&
				completion.adoptFromSessionKey !== completion.sessionKey
			) {
				useChatStore
					.getState()
					.adoptSession(completion.adoptFromSessionKey, completion.sessionKey);
			}
			useChatStore.getState().finalizeMessage(completion.sessionKey, {
				timestamp: Date.now(),
			});
			useSessionsStore.getState().setActiveSession(agentId, nextSessionRef);
			if (event.usage) {
				useContextUsageStore.getState().setUsage(nextSessionKey, event.usage);
			}
			options.refreshSidebar();
			return true;
		}
		case "error": {
			const agentId = options.getActiveAgentId();
			if (agentId) {
				const sessionKey = options.routeObservedSessionKey(
					agentId,
					event.sessionId,
				);
				useChatStore.getState().setError(sessionKey, event.message);
			}
			options.clearLiveRunSessions();
			useRuntimeStore.getState().setError(event.message);
			return true;
		}
		default:
			return false;
	}
}

export function inferImageMediaTypeFromPath(
	path: string,
): ImageRef["mediaType"] | undefined {
	const lowerPath = path.toLowerCase();
	if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) {
		return "image/jpeg";
	}
	if (lowerPath.endsWith(".png")) {
		return "image/png";
	}
	if (lowerPath.endsWith(".gif")) {
		return "image/gif";
	}
	if (lowerPath.endsWith(".webp")) {
		return "image/webp";
	}
	return undefined;
}
