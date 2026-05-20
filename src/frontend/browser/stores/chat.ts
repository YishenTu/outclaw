import { create } from "zustand";
import { createDisplayCompactBoundaryMessage } from "../../../common/compact-boundary.ts";
import { isHeartbeatNoopResult } from "../../../common/heartbeat-prompt.ts";
import type {
	AssistantTurnMetadata,
	DisplayChatMessage,
	DisplayImage,
	DisplayMessage,
} from "../../../common/protocol.ts";
import {
	appendThinkingBlockDelta,
	distinctThinkingBlocks,
	effectiveThinkingBlocks,
} from "../../../common/thinking-blocks.ts";
import { normalizeReplayHistory } from "../chat/replay-history.ts";

type AssistantChatMessage = DisplayChatMessage & { role: "assistant" };

export interface ChatSession {
	messages: DisplayMessage[];
	queuedPrompts: DisplayChatMessage[];
	streamingText: string;
	streamingThinking: string;
	streamingThinkingBlocks: string[];
	streamingThinkingBlockId?: string;
	streamingImages: DisplayImage[];
	heartbeatPending: boolean;
	heartbeatStreamingText: string;
	heartbeatStreamingThinking: string;
	heartbeatStreamingThinkingBlocks: string[];
	heartbeatStreamingThinkingBlockId?: string;
	heartbeatStreamingImages: DisplayImage[];
	isThinking: boolean;
	isStreaming: boolean;
	isCompacting: boolean;
	pendingPromptStart: boolean;
	error: string | null;
	thinkingStartedAt: number | null;
}

export interface ChatState {
	/** keyed by sessionKey = `${agentId}:${providerId}:${sdkSessionId}` */
	sessions: Record<string, ChatSession>;

	getMessages: (sessionKey: string) => DisplayMessage[];
	getSession: (sessionKey: string) => ChatSession | undefined;

	pushMessage: (sessionKey: string, message: DisplayMessage) => void;
	queuePrompt: (sessionKey: string, message: DisplayChatMessage) => void;
	confirmPrompt: (sessionKey: string, message: DisplayChatMessage) => void;
	startAssistantTurn: (
		sessionKey: string,
		options?: { pendingPromptStart?: boolean },
	) => void;
	replaceHistory: (
		sessionKey: string,
		messages: DisplayMessage[],
		options?: {
			preservePendingTurn?: boolean;
		},
	) => void;
	appendText: (sessionKey: string, text: string) => void;
	appendThinking: (sessionKey: string, text: string, blockId?: string) => void;
	appendImage: (sessionKey: string, image: DisplayImage) => void;
	restoreStreamingState: (
		sessionKey: string,
		snapshot: {
			images: DisplayImage[];
			text: string;
			thinking: string;
			thinkingBlocks?: string[];
			thinkingBlockId?: string;
		},
	) => void;
	setStreaming: (sessionKey: string, streaming: boolean) => void;
	setThinking: (sessionKey: string, thinking: boolean) => void;
	setCompacting: (sessionKey: string, compacting: boolean) => void;
	finishCompacting: (sessionKey: string) => void;
	setError: (sessionKey: string, error: string | null) => void;
	finalizeMessage: (
		sessionKey: string,
		options?: {
			timestamp?: number;
		},
	) => void;
	adoptSession: (fromSessionKey: string, toSessionKey: string) => void;
	clearSession: (sessionKey: string) => void;
	clearPendingSessions: (agentId: string) => void;
}

function createEmptySession(): ChatSession {
	return {
		messages: [],
		queuedPrompts: [],
		streamingText: "",
		streamingThinking: "",
		streamingThinkingBlocks: [],
		streamingImages: [],
		heartbeatPending: false,
		heartbeatStreamingText: "",
		heartbeatStreamingThinking: "",
		heartbeatStreamingThinkingBlocks: [],
		heartbeatStreamingImages: [],
		isThinking: false,
		isStreaming: false,
		isCompacting: false,
		pendingPromptStart: false,
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
	queuePrompt: (sessionKey, message) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						queuedPrompts: [...session.queuedPrompts, message],
						error: null,
					},
				},
			};
		}),
	confirmPrompt: (sessionKey, message) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: confirmPromptStarted(session, message),
				},
			};
		}),
	startAssistantTurn: (sessionKey, options) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						heartbeatPending:
							session.heartbeatPending ||
							hasPendingHeartbeatIndicator(session.messages),
						isThinking: true,
						isStreaming: true,
						pendingPromptStart: options?.pendingPromptStart ?? false,
						error: null,
						thinkingStartedAt: session.thinkingStartedAt ?? Date.now(),
					},
				},
			};
		}),
	replaceHistory: (sessionKey, messages, options) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			const normalizedMessages = normalizeReplayHistory(messages);
			const preservePendingTurn = options?.preservePendingTurn ?? true;
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						messages: normalizedMessages,
						queuedPrompts: preservePendingTurn ? session.queuedPrompts : [],
						streamingText: "",
						streamingThinking: "",
						streamingThinkingBlocks: [],
						streamingThinkingBlockId: undefined,
						streamingImages: [],
						heartbeatPending:
							preservePendingTurn &&
							(session.isThinking || session.isStreaming) &&
							hasPendingHeartbeatIndicator(normalizedMessages),
						heartbeatStreamingText: "",
						heartbeatStreamingThinking: "",
						heartbeatStreamingThinkingBlocks: [],
						heartbeatStreamingThinkingBlockId: undefined,
						heartbeatStreamingImages: [],
						isThinking: preservePendingTurn ? session.isThinking : false,
						isStreaming: preservePendingTurn ? session.isStreaming : false,
						isCompacting: preservePendingTurn ? session.isCompacting : false,
						pendingPromptStart: preservePendingTurn
							? session.pendingPromptStart
							: false,
						error: null,
						thinkingStartedAt:
							preservePendingTurn && (session.isThinking || session.isStreaming)
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
						pendingPromptStart: false,
						isStreaming: true,
					},
				},
			};
		}),
	appendThinking: (sessionKey, text, blockId) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			const streamingThinking = appendThinkingBlockDelta(
				{
					text: session.streamingThinking,
					blocks: session.streamingThinkingBlocks,
					currentBlockId: session.streamingThinkingBlockId,
				},
				{ text, blockId },
			);
			const heartbeatThinking = appendThinkingBlockDelta(
				{
					text: session.heartbeatStreamingThinking,
					blocks: session.heartbeatStreamingThinkingBlocks,
					currentBlockId: session.heartbeatStreamingThinkingBlockId,
				},
				{ text, blockId },
			);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						streamingThinking: session.heartbeatPending
							? session.streamingThinking
							: streamingThinking.text,
						streamingThinkingBlocks: session.heartbeatPending
							? session.streamingThinkingBlocks
							: streamingThinking.blocks,
						streamingThinkingBlockId: session.heartbeatPending
							? session.streamingThinkingBlockId
							: streamingThinking.currentBlockId,
						heartbeatStreamingThinking: session.heartbeatPending
							? heartbeatThinking.text
							: session.heartbeatStreamingThinking,
						heartbeatStreamingThinkingBlocks: session.heartbeatPending
							? heartbeatThinking.blocks
							: session.heartbeatStreamingThinkingBlocks,
						heartbeatStreamingThinkingBlockId: session.heartbeatPending
							? heartbeatThinking.currentBlockId
							: session.heartbeatStreamingThinkingBlockId,
						isThinking: true,
						pendingPromptStart: false,
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
						pendingPromptStart: false,
					},
				},
			};
		}),
	restoreStreamingState: (sessionKey, snapshot) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			const messages = dropReplayedStreamingAssistantTail(
				session.messages,
				snapshot,
			);
			const snapshotThinkingBlocks = effectiveThinkingBlocks({
				text: snapshot.thinking,
				blocks: snapshot.thinkingBlocks,
			});
			const heartbeatPending =
				session.heartbeatPending || hasPendingHeartbeatIndicator(messages);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						messages,
						streamingText: heartbeatPending ? "" : snapshot.text,
						streamingThinking: heartbeatPending ? "" : snapshot.thinking,
						streamingThinkingBlocks: heartbeatPending
							? []
							: snapshotThinkingBlocks,
						streamingThinkingBlockId: heartbeatPending
							? undefined
							: snapshot.thinkingBlockId,
						streamingImages: heartbeatPending ? [] : snapshot.images,
						heartbeatPending,
						heartbeatStreamingText: heartbeatPending ? snapshot.text : "",
						heartbeatStreamingThinking: heartbeatPending
							? snapshot.thinking
							: "",
						heartbeatStreamingThinkingBlocks: heartbeatPending
							? snapshotThinkingBlocks
							: [],
						heartbeatStreamingThinkingBlockId: heartbeatPending
							? snapshot.thinkingBlockId
							: undefined,
						heartbeatStreamingImages: heartbeatPending ? snapshot.images : [],
						isThinking:
							session.isThinking ||
							snapshot.thinking !== "" ||
							snapshot.text !== "" ||
							snapshot.images.length > 0,
						isStreaming:
							session.isStreaming ||
							snapshot.text !== "" ||
							snapshot.images.length > 0,
						pendingPromptStart:
							snapshot.thinking !== "" ||
							snapshot.text !== "" ||
							snapshot.images.length > 0
								? false
								: session.pendingPromptStart,
						thinkingStartedAt:
							session.thinkingStartedAt ??
							(snapshot.thinking !== "" ||
							snapshot.text !== "" ||
							snapshot.images.length > 0
								? Date.now()
								: null),
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
	finishCompacting: (sessionKey) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: {
						...session,
						messages: [
							...session.messages,
							createDisplayCompactBoundaryMessage(),
						],
						isCompacting: false,
						pendingPromptStart: false,
						error: null,
					},
				},
			};
		}),
	setError: (sessionKey, error) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			const nextSession = {
				...session,
				error,
				isThinking: error ? false : session.isThinking,
				isStreaming: error ? false : session.isStreaming,
				isCompacting: error ? false : session.isCompacting,
				pendingPromptStart: error ? false : session.pendingPromptStart,
				heartbeatPending: error ? false : session.heartbeatPending,
				heartbeatStreamingText: error ? "" : session.heartbeatStreamingText,
				heartbeatStreamingThinking: error
					? ""
					: session.heartbeatStreamingThinking,
				heartbeatStreamingThinkingBlocks: error
					? []
					: session.heartbeatStreamingThinkingBlocks,
				heartbeatStreamingThinkingBlockId: error
					? undefined
					: session.heartbeatStreamingThinkingBlockId,
				heartbeatStreamingImages: error ? [] : session.heartbeatStreamingImages,
				thinkingStartedAt: error ? null : session.thinkingStartedAt,
			};
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: nextSession,
				},
			};
		}),
	finalizeMessage: (sessionKey, options) =>
		set((state) => {
			const session = getOrCreateSession(state.sessions, sessionKey);
			const messages = finalizeSessionMessages(session, options);
			const settledSession = {
				...session,
				messages,
				streamingText: "",
				streamingThinking: "",
				streamingThinkingBlocks: [],
				streamingThinkingBlockId: undefined,
				streamingImages: [],
				heartbeatPending: false,
				heartbeatStreamingText: "",
				heartbeatStreamingThinking: "",
				heartbeatStreamingThinkingBlocks: [],
				heartbeatStreamingThinkingBlockId: undefined,
				heartbeatStreamingImages: [],
				isThinking: false,
				isStreaming: false,
				isCompacting: false,
				pendingPromptStart: false,
				error: null,
				thinkingStartedAt: null,
			};
			return {
				sessions: {
					...state.sessions,
					[sessionKey]: settledSession,
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
	clearPendingSessions: (agentId) =>
		set((state) => ({
			sessions: Object.fromEntries(
				Object.entries(state.sessions).filter(
					([sessionKey]) =>
						!(
							sessionKey.startsWith(`${agentId}:`) &&
							sessionKey.endsWith(":__pending__")
						),
				),
			),
		})),
}));

function finalizeSessionMessages(
	session: ChatSession,
	options?: {
		timestamp?: number;
	},
): DisplayMessage[] {
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
			createAssistantMessage({
				content,
				thinking: session.heartbeatStreamingThinking,
				thinkingBlocks: session.heartbeatStreamingThinkingBlocks,
				images: session.heartbeatStreamingImages,
				timestamp: options?.timestamp,
				assistantTurn: {
					source: "heartbeat" as const,
				},
			}),
		];
	}

	const hasStreamingContent =
		session.streamingText !== "" ||
		session.streamingThinking !== "" ||
		session.streamingImages.length > 0;
	return hasStreamingContent
		? [
				...session.messages,
				createAssistantMessage({
					content: session.streamingText,
					thinking: session.streamingThinking,
					thinkingBlocks: session.streamingThinkingBlocks,
					images: session.streamingImages,
					timestamp: options?.timestamp,
					assistantTurn: createUserAssistantTurn(
						session.messages,
						options?.timestamp,
					),
				}),
			]
		: session.messages;
}

function createAssistantMessage(params: {
	content: string;
	thinking: string;
	thinkingBlocks: string[];
	images: DisplayImage[];
	timestamp?: number;
	assistantTurn?: AssistantTurnMetadata;
}): DisplayChatMessage {
	const thinkingBlocks = distinctThinkingBlocks({
		text: params.thinking,
		blocks: params.thinkingBlocks,
	});
	return {
		kind: "chat",
		role: "assistant",
		content: params.content,
		...(params.thinking !== "" ? { thinking: params.thinking } : {}),
		...(thinkingBlocks ? { thinkingBlocks } : {}),
		...(params.images.length > 0 ? { images: params.images } : {}),
		...(params.timestamp !== undefined ? { timestamp: params.timestamp } : {}),
		...(params.assistantTurn ? { assistantTurn: params.assistantTurn } : {}),
	};
}

export function hasActiveChatTurn(session: ChatSession): boolean {
	return (
		session.isThinking ||
		session.isStreaming ||
		session.isCompacting ||
		session.pendingPromptStart ||
		session.heartbeatPending ||
		session.streamingText !== "" ||
		session.streamingThinking !== "" ||
		session.streamingImages.length > 0 ||
		session.heartbeatStreamingText !== "" ||
		session.heartbeatStreamingThinking !== "" ||
		session.heartbeatStreamingImages.length > 0
	);
}

export function shouldQueuePromptInChatSession(
	session: ChatSession | undefined,
): boolean {
	return (
		session !== undefined &&
		(hasActiveChatTurn(session) || session.queuedPrompts.length > 0)
	);
}

function confirmPromptStarted(
	session: ChatSession,
	message: DisplayChatMessage,
): ChatSession {
	const lastMessage = session.messages.at(-1);
	const pendingSession =
		session.pendingPromptStart &&
		lastMessage?.kind === "chat" &&
		lastMessage.role === "user" &&
		!isSamePromptMessage(lastMessage, message)
			? demotePendingPromptStart(session, lastMessage)
			: session;

	const [queuedPrompt, ...queuedPrompts] = pendingSession.queuedPrompts;
	if (queuedPrompt && isSamePromptMessage(queuedPrompt, message)) {
		return startConfirmedAssistantTurn({
			...pendingSession,
			messages: [...pendingSession.messages, queuedPrompt],
			queuedPrompts,
		});
	}

	const pendingLastMessage = pendingSession.messages.at(-1);
	if (
		hasActiveChatTurn(pendingSession) &&
		pendingLastMessage?.kind === "chat" &&
		pendingLastMessage.role === "user" &&
		isSamePromptMessage(pendingLastMessage, message)
	) {
		return startConfirmedAssistantTurn(pendingSession);
	}

	return startConfirmedAssistantTurn({
		...pendingSession,
		messages: [...pendingSession.messages, message],
	});
}

function startConfirmedAssistantTurn(session: ChatSession): ChatSession {
	return {
		...session,
		isThinking: true,
		isStreaming: true,
		pendingPromptStart: false,
		error: null,
		thinkingStartedAt: session.thinkingStartedAt ?? Date.now(),
	};
}

function demotePendingPromptStart(
	session: ChatSession,
	prompt: DisplayChatMessage,
): ChatSession {
	return {
		...session,
		messages: session.messages.slice(0, -1),
		queuedPrompts: [prompt, ...session.queuedPrompts],
		pendingPromptStart: false,
	};
}

function isSamePromptMessage(
	left: DisplayChatMessage,
	right: DisplayChatMessage,
): boolean {
	return (
		left.role === right.role &&
		left.content === right.content &&
		(left.images?.length ?? 0) === (right.images?.length ?? 0) &&
		(left.replyContext?.text ?? "") === (right.replyContext?.text ?? "")
	);
}

function createUserAssistantTurn(
	messages: DisplayMessage[],
	completedAt: number | undefined,
): AssistantTurnMetadata | undefined {
	if (completedAt === undefined) {
		return undefined;
	}

	const startedAt = findPreviousUserTimestamp(messages);
	if (startedAt === undefined || completedAt < startedAt) {
		return undefined;
	}

	return {
		source: "user",
		startedAt,
		durationMs: completedAt - startedAt,
	};
}

function findPreviousUserTimestamp(
	messages: DisplayMessage[],
): number | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (
			message?.kind === "chat" &&
			message.role === "user" &&
			message.timestamp !== undefined
		) {
			return message.timestamp;
		}
	}

	return undefined;
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

function dropReplayedStreamingAssistantTail(
	messages: DisplayMessage[],
	snapshot: {
		images: DisplayImage[];
		text: string;
		thinking: string;
	},
): DisplayMessage[] {
	const lastMessage = messages.at(-1);
	if (
		!isAssistantChatMessage(lastMessage) ||
		!streamingSnapshotContainsMessage(lastMessage, snapshot)
	) {
		return messages;
	}

	return messages.slice(0, -1);
}

function streamingSnapshotContainsMessage(
	message: AssistantChatMessage,
	snapshot: {
		images: DisplayImage[];
		text: string;
		thinking: string;
	},
): boolean {
	const replayedThinking = message.thinking ?? "";
	const replayedImages = message.images ?? [];
	const hasReplayedOutput =
		message.content !== "" ||
		replayedThinking !== "" ||
		replayedImages.length > 0;
	if (!hasReplayedOutput) {
		return false;
	}

	return (
		snapshot.text.startsWith(message.content) &&
		snapshot.thinking.startsWith(replayedThinking) &&
		imageListStartsWith(snapshot.images, replayedImages)
	);
}

function imageListStartsWith(
	images: DisplayImage[],
	prefix: DisplayImage[],
): boolean {
	if (prefix.length > images.length) {
		return false;
	}

	return prefix.every((image, index) => {
		const candidate = images[index];
		if (!candidate || candidate.kind !== image.kind) {
			return false;
		}
		if (image.mediaType !== candidate.mediaType) {
			return false;
		}

		if (image.kind === "managed") {
			return candidate.kind === "managed" && candidate.path === image.path;
		}
		if (image.kind === "inline") {
			return candidate.kind === "inline" && candidate.base64 === image.base64;
		}

		return candidate.kind === "placeholder";
	});
}

function isAssistantChatMessage(
	message: DisplayMessage | undefined,
): message is AssistantChatMessage {
	return message?.kind === "chat" && message.role === "assistant";
}

function hasPendingHeartbeatIndicator(messages: DisplayMessage[]): boolean {
	const lastMessage = messages.at(-1);
	return lastMessage?.kind === "system" && lastMessage.event === "heartbeat";
}
