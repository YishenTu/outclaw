import { create } from "zustand";
import { isHeartbeatNoopResult } from "../../../common/heartbeat-prompt.ts";
import type { DisplayImage, DisplayMessage } from "../../../common/protocol.ts";

export interface ChatSession {
	messages: DisplayMessage[];
	streamingText: string;
	streamingThinking: string;
	streamingImages: DisplayImage[];
	heartbeatPending: boolean;
	heartbeatStreamingText: string;
	heartbeatStreamingThinking: string;
	heartbeatStreamingImages: DisplayImage[];
	isThinking: boolean;
	isStreaming: boolean;
	isCompacting: boolean;
	error: string | null;
	thinkingStartedAt: number | null;
}

export interface ChatState {
	/** keyed by sessionKey = `${agentId}:${providerId}:${sdkSessionId}` */
	sessions: Record<string, ChatSession>;

	getMessages: (sessionKey: string) => DisplayMessage[];
	getSession: (sessionKey: string) => ChatSession | undefined;

	pushMessage: (sessionKey: string, message: DisplayMessage) => void;
	startAssistantTurn: (sessionKey: string) => void;
	replaceHistory: (sessionKey: string, messages: DisplayMessage[]) => void;
	appendText: (sessionKey: string, text: string) => void;
	appendThinking: (sessionKey: string, text: string) => void;
	appendImage: (sessionKey: string, image: DisplayImage) => void;
	setStreaming: (sessionKey: string, streaming: boolean) => void;
	setThinking: (sessionKey: string, thinking: boolean) => void;
	setCompacting: (sessionKey: string, compacting: boolean) => void;
	setError: (sessionKey: string, error: string | null) => void;
	finalizeMessage: (sessionKey: string) => void;
	adoptSession: (fromSessionKey: string, toSessionKey: string) => void;
	clearSession: (sessionKey: string) => void;
}

function createEmptySession(): ChatSession {
	return {
		messages: [],
		streamingText: "",
		streamingThinking: "",
		streamingImages: [],
		heartbeatPending: false,
		heartbeatStreamingText: "",
		heartbeatStreamingThinking: "",
		heartbeatStreamingImages: [],
		isThinking: false,
		isStreaming: false,
		isCompacting: false,
		error: null,
		thinkingStartedAt: null,
	};
}

const EMPTY_MESSAGES: DisplayMessage[] = [];

function getOrCreateSession(
	sessions: Record<string, ChatSession>,
	sessionKey: string,
): ChatSession {
	return sessions[sessionKey] ?? createEmptySession();
}

export const useChatStore = create<ChatState>((set, get) => ({
	sessions: {},
	getMessages: (sessionKey) =>
		get().sessions[sessionKey]?.messages ?? EMPTY_MESSAGES,
	getSession: (sessionKey) => get().sessions[sessionKey],
	pushMessage: (sessionKey, message) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						messages: [...session.messages, message],
						heartbeatPending:
							message.kind === "system" && message.event === "heartbeat"
								? true
								: session.heartbeatPending,
						error: null,
					},
				},
			};
		}),
	startAssistantTurn: (sessionKey) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						isThinking: true,
						isStreaming: true,
						error: null,
						thinkingStartedAt: session.thinkingStartedAt ?? Date.now(),
					},
				},
			};
		}),
	replaceHistory: (sessionKey, messages) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						messages,
						streamingText: "",
						streamingThinking: "",
						streamingImages: [],
						heartbeatPending: false,
						heartbeatStreamingText: "",
						heartbeatStreamingThinking: "",
						heartbeatStreamingImages: [],
						isThinking: session.isThinking,
						isStreaming: session.isStreaming,
						error: null,
						thinkingStartedAt:
							session.isThinking || session.isStreaming
								? session.thinkingStartedAt
								: null,
					},
				},
			};
		}),
	appendText: (sessionKey, text) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						streamingText: session.heartbeatPending
							? session.streamingText
							: `${session.streamingText}${text}`,
						heartbeatStreamingText: session.heartbeatPending
							? `${session.heartbeatStreamingText}${text}`
							: session.heartbeatStreamingText,
						isStreaming: true,
					},
				},
			};
		}),
	appendThinking: (sessionKey, text) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						streamingThinking: session.heartbeatPending
							? session.streamingThinking
							: `${session.streamingThinking}${text}`,
						heartbeatStreamingThinking: session.heartbeatPending
							? `${session.heartbeatStreamingThinking}${text}`
							: session.heartbeatStreamingThinking,
						isThinking: true,
						thinkingStartedAt: session.thinkingStartedAt ?? Date.now(),
					},
				},
			};
		}),
	appendImage: (sessionKey, image) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						streamingImages: session.heartbeatPending
							? session.streamingImages
							: [...session.streamingImages, image],
						heartbeatStreamingImages: session.heartbeatPending
							? [...session.heartbeatStreamingImages, image]
							: session.heartbeatStreamingImages,
						isStreaming: true,
					},
				},
			};
		}),
	setStreaming: (sessionKey, streaming) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						isStreaming: streaming,
					},
				},
			};
		}),
	setThinking: (sessionKey, thinking) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						isThinking: thinking,
						thinkingStartedAt: thinking
							? (session.thinkingStartedAt ?? Date.now())
							: null,
					},
				},
			};
		}),
	setCompacting: (sessionKey, compacting) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						isCompacting: compacting,
					},
				},
			};
		}),
	setError: (sessionKey, error) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						error,
						isThinking: error ? false : session.isThinking,
						isStreaming: error ? false : session.isStreaming,
						heartbeatPending: error ? false : session.heartbeatPending,
						heartbeatStreamingText: error ? "" : session.heartbeatStreamingText,
						heartbeatStreamingThinking: error
							? ""
							: session.heartbeatStreamingThinking,
						heartbeatStreamingImages: error
							? []
							: session.heartbeatStreamingImages,
						thinkingStartedAt: error ? null : session.thinkingStartedAt,
					},
				},
			};
		}),
	finalizeMessage: (sessionKey) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			const messages = finalizeSessionMessages(session);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						messages,
						streamingText: "",
						streamingThinking: "",
						streamingImages: [],
						heartbeatPending: false,
						heartbeatStreamingText: "",
						heartbeatStreamingThinking: "",
						heartbeatStreamingImages: [],
						isThinking: false,
						isStreaming: false,
						error: null,
						thinkingStartedAt: null,
					},
				},
			};
		}),
	adoptSession: (fromSessionKey, toSessionKey) =>
		set((state) => {
			if (fromSessionKey === toSessionKey) {
				return state;
			}

			const sourceSession = state.sessions[fromSessionKey];
			if (!sourceSession) {
				return state;
			}

			const { [fromSessionKey]: _discarded, ...remainingSessions } =
				state.sessions;
			return {
				sessions: {
					...remainingSessions,
					[toSessionKey]: sourceSession,
				},
			};
		}),
	clearSession: (sessionKey) =>
		set((state) => {
			const { [sessionKey]: _deleted, ...sessions } = state.sessions;
			return { sessions };
		}),
}));

function finalizeSessionMessages(session: ChatSession): DisplayMessage[] {
	if (session.heartbeatPending) {
		const content = isHeartbeatNoopResult(session.heartbeatStreamingText)
			? ""
			: session.heartbeatStreamingText;
		const hasVisibleHeartbeatContent =
			content !== "" || session.heartbeatStreamingImages.length > 0;
		if (!hasVisibleHeartbeatContent) {
			return dropPendingHeartbeatIndicator(session.messages);
		}

		return [
			...session.messages,
			{
				kind: "chat" as const,
				role: "assistant" as const,
				content,
				thinking:
					session.heartbeatStreamingThinking === ""
						? undefined
						: session.heartbeatStreamingThinking,
				images:
					session.heartbeatStreamingImages.length > 0
						? session.heartbeatStreamingImages
						: undefined,
			},
		];
	}

	const hasStreamingContent =
		session.streamingText !== "" ||
		session.streamingThinking !== "" ||
		session.streamingImages.length > 0;
	return hasStreamingContent
		? [
				...session.messages,
				{
					kind: "chat" as const,
					role: "assistant" as const,
					content: session.streamingText,
					thinking:
						session.streamingThinking === ""
							? undefined
							: session.streamingThinking,
					images:
						session.streamingImages.length > 0
							? session.streamingImages
							: undefined,
				},
			]
		: session.messages;
}

function dropPendingHeartbeatIndicator(
	messages: DisplayMessage[],
): DisplayMessage[] {
	const lastMessage = messages.at(-1);
	if (lastMessage?.kind === "system" && lastMessage.event === "heartbeat") {
		return messages.slice(0, -1);
	}

	return messages;
}
