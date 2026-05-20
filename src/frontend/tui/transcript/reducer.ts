import {
	assistantTextSegment,
	assistantThinkingSegment,
	startsNewAssistantMessageSegment,
} from "../../../common/assistant-message-segments.ts";
import { COMPACT_BOUNDARY_TEXT } from "../../../common/compact-boundary.ts";
import { isHeartbeatNoopResult } from "../../../common/heartbeat-prompt.ts";
import type { AssistantMessageSegment } from "../../../common/protocol.ts";
import {
	appendThinkingBlockDelta,
	createThinkingBlockState,
} from "../../../common/thinking-blocks.ts";
import type { SessionMenuData } from "../sessions/types.ts";
import type { TuiMessage, TuiMessageRole, TuiState } from "./state.ts";

export type TuiAction =
	| { type: "append_streaming"; text: string }
	| { type: "append_thinking"; text: string; blockId?: string }
	| { type: "commit_streaming" }
	| { type: "queue_prompt"; text: string }
	| {
			type: "confirm_tui_prompt";
			text: string;
			replyText?: string;
			compacting: boolean;
	  }
	| {
			type: "push";
			role: TuiMessageRole;
			text: string;
			replyText?: string;
			variant?: TuiMessage["variant"];
	  }
	| {
			type: "push_and_stop";
			role: TuiMessageRole;
			text: string;
			replyText?: string;
			variant?: TuiMessage["variant"];
	  }
	| { type: "clear" }
	| { type: "replay"; messages: TuiMessage[] }
	| { type: "session_menu"; data: SessionMenuData }
	| { type: "start_compacting" }
	| { type: "finish_compacting" }
	| { type: "noop" };

function flushStreamingBuffers(
	messages: TuiMessage[],
	nextId: number,
	state: TuiState,
): { messages: TuiMessage[]; nextId: number } {
	if (state.activePrompt) {
		messages.push(state.activePrompt);
	}
	if (state.streamingThinking) {
		messages.push({
			id: nextId,
			role: "thinking" as const,
			text: state.streamingThinking,
		});
		nextId += 1;
	}
	if (state.streaming) {
		messages.push({
			id: nextId,
			role: "assistant" as const,
			text: state.streaming,
		});
		nextId += 1;
	}
	return { messages, nextId };
}

function flushStreamingThinking(state: TuiState): TuiState {
	if (!state.streamingThinking) {
		return state;
	}
	const flushed = flushStreamingBuffers([...state.messages], state.nextId, {
		...state,
		streaming: "",
	});
	return {
		...state,
		activePrompt: undefined,
		messages: flushed.messages,
		streamingThinking: "",
		streamingThinkingBlockId: undefined,
		nextId: flushed.nextId,
	};
}

function flushStreamingText(state: TuiState): TuiState {
	if (!state.streaming) {
		return state;
	}
	const flushed = flushStreamingBuffers([...state.messages], state.nextId, {
		...state,
		streamingThinking: "",
		streamingThinkingBlockId: undefined,
	});
	return {
		...state,
		activePrompt: undefined,
		messages: flushed.messages,
		streaming: "",
		nextId: flushed.nextId,
	};
}

function streamingTextSegment(state: TuiState): AssistantMessageSegment {
	return assistantTextSegment(state.streaming);
}

function streamingThinkingSegment(state: TuiState): AssistantMessageSegment {
	return assistantThinkingSegment(
		state.streamingThinking,
		state.streamingThinkingBlockId,
	);
}

function dropPendingHeartbeatIndicator(messages: TuiMessage[]): TuiMessage[] {
	const lastMessage = messages.at(-1);
	if (lastMessage?.variant === "heartbeat") {
		return messages.slice(0, -1);
	}
	return messages;
}

function flushHeartbeatBuffers(state: TuiState): {
	messages: TuiMessage[];
	nextId: number;
} {
	if (
		state.heartbeatStreaming === "" ||
		isHeartbeatNoopResult(state.heartbeatStreaming)
	) {
		return {
			messages: dropPendingHeartbeatIndicator(state.messages),
			nextId: state.nextId,
		};
	}

	return flushStreamingBuffers([...state.messages], state.nextId, {
		...state,
		streaming: state.heartbeatStreaming,
		streamingThinking: state.heartbeatStreamingThinking,
	});
}

export function applyAction(state: TuiState, action: TuiAction): TuiState {
	switch (action.type) {
		case "append_streaming": {
			const incoming = assistantTextSegment(action.text);
			const baseState = state.heartbeatPending
				? state
				: startsNewAssistantMessageSegment(
							streamingThinkingSegment(state),
							incoming,
						)
					? flushStreamingThinking(state)
					: state;
			return {
				...baseState,
				streaming: baseState.heartbeatPending
					? baseState.streaming
					: baseState.streaming + action.text,
				heartbeatStreaming: baseState.heartbeatPending
					? baseState.heartbeatStreaming + action.text
					: baseState.heartbeatStreaming,
				pendingPromptStart: false,
				running: true,
			};
		}
		case "append_thinking": {
			const incoming = assistantThinkingSegment(action.text, action.blockId);
			const baseState =
				state.heartbeatPending ||
				!startsNewAssistantMessageSegment(streamingTextSegment(state), incoming)
					? state
					: flushStreamingText(state);
			const streamingThinking = createThinkingBlockState({
				text: baseState.streamingThinking,
				blocks:
					baseState.streamingThinking === ""
						? []
						: [baseState.streamingThinking],
				currentBlockId: baseState.streamingThinkingBlockId,
			});
			const heartbeatThinking = createThinkingBlockState({
				text: baseState.heartbeatStreamingThinking,
				blocks:
					baseState.heartbeatStreamingThinking === ""
						? []
						: [baseState.heartbeatStreamingThinking],
				currentBlockId: baseState.heartbeatStreamingThinkingBlockId,
			});
			if (
				!baseState.heartbeatPending &&
				startsNewAssistantMessageSegment(
					streamingThinkingSegment(baseState),
					incoming,
				)
			) {
				const flushedState = flushStreamingThinking(baseState);
				return {
					...flushedState,
					activePrompt: undefined,
					streamingThinking: action.text,
					streamingThinkingBlockId: action.blockId,
					pendingPromptStart: false,
					running: true,
				};
			}
			const nextStreamingThinking = appendThinkingBlockDelta(
				streamingThinking,
				action,
			);
			const nextHeartbeatThinking = appendThinkingBlockDelta(
				heartbeatThinking,
				action,
			);
			return {
				...baseState,
				streamingThinking: baseState.heartbeatPending
					? baseState.streamingThinking
					: nextStreamingThinking.text,
				streamingThinkingBlockId: baseState.heartbeatPending
					? baseState.streamingThinkingBlockId
					: nextStreamingThinking.currentBlockId,
				heartbeatStreamingThinking: baseState.heartbeatPending
					? nextHeartbeatThinking.text
					: baseState.heartbeatStreamingThinking,
				heartbeatStreamingThinkingBlockId: baseState.heartbeatPending
					? nextHeartbeatThinking.currentBlockId
					: baseState.heartbeatStreamingThinkingBlockId,
				pendingPromptStart: false,
				running: true,
			};
		}
		case "commit_streaming": {
			if (
				!state.activePrompt &&
				!state.streaming &&
				!state.streamingThinking &&
				!state.heartbeatStreaming &&
				!state.heartbeatStreamingThinking
			) {
				return {
					...state,
					activePrompt: undefined,
					compacting: false,
					pendingPromptStart: false,
					running: false,
				};
			}
			const flushed = state.heartbeatPending
				? flushHeartbeatBuffers(state)
				: flushStreamingBuffers([...state.messages], state.nextId, state);
			return {
				...state,
				activePrompt: undefined,
				compacting: false,
				messages: flushed.messages,
				streaming: "",
				streamingThinking: "",
				streamingThinkingBlockId: undefined,
				heartbeatPending: false,
				heartbeatStreaming: "",
				heartbeatStreamingThinking: "",
				heartbeatStreamingThinkingBlockId: undefined,
				pendingPromptStart: false,
				running: false,
				nextId: flushed.nextId,
			};
		}
		case "queue_prompt":
			return {
				...state,
				queuedPrompts: [
					...state.queuedPrompts,
					{ id: state.nextId, text: action.text },
				],
				nextId: state.nextId + 1,
			};
		case "confirm_tui_prompt":
			return confirmTuiPrompt(state, action);
		case "push": {
			const stateWithPendingPromptQueued =
				action.role === "user" ? queuePendingPromptStart(state) : state;
			return {
				...stateWithPendingPromptQueued,
				messages: [
					...stateWithPendingPromptQueued.messages,
					{
						id: stateWithPendingPromptQueued.nextId,
						role: action.role,
						text: action.text,
						replyText: action.replyText,
						variant: action.variant,
					},
				],
				heartbeatPending: action.variant === "heartbeat",
				heartbeatStreaming:
					action.variant === "heartbeat"
						? ""
						: stateWithPendingPromptQueued.heartbeatStreaming,
				heartbeatStreamingThinking:
					action.variant === "heartbeat"
						? ""
						: stateWithPendingPromptQueued.heartbeatStreamingThinking,
				heartbeatStreamingThinkingBlockId:
					action.variant === "heartbeat"
						? undefined
						: stateWithPendingPromptQueued.heartbeatStreamingThinkingBlockId,
				nextId: stateWithPendingPromptQueued.nextId + 1,
			};
		}
		case "push_and_stop": {
			const flushed = state.heartbeatPending
				? flushHeartbeatBuffers(state)
				: flushStreamingBuffers([...state.messages], state.nextId, state);
			flushed.messages.push({
				id: flushed.nextId,
				role: action.role,
				text: action.text,
				replyText: action.replyText,
				variant: action.variant,
			});
			return {
				...state,
				activePrompt: undefined,
				compacting: false,
				messages: flushed.messages,
				streaming: "",
				streamingThinking: "",
				streamingThinkingBlockId: undefined,
				heartbeatPending: false,
				heartbeatStreaming: "",
				heartbeatStreamingThinking: "",
				heartbeatStreamingThinkingBlockId: undefined,
				pendingPromptStart: false,
				running: false,
				nextId: flushed.nextId + 1,
			};
		}
		case "clear":
			return {
				...state,
				activePrompt: undefined,
				compacting: false,
				messages: [],
				streaming: "",
				streamingThinking: "",
				streamingThinkingBlockId: undefined,
				heartbeatPending: false,
				heartbeatStreaming: "",
				heartbeatStreamingThinking: "",
				heartbeatStreamingThinkingBlockId: undefined,
				pendingPromptStart: false,
				queuedPrompts: [],
				running: false,
				transcriptVersion: state.transcriptVersion + 1,
			};
		case "replay": {
			const maxId = action.messages.reduce((max, message) => {
				return Math.max(max, message.id);
			}, 0);
			return {
				...state,
				activePrompt: undefined,
				compacting: false,
				messages: action.messages,
				heartbeatPending: false,
				heartbeatStreaming: "",
				heartbeatStreamingThinking: "",
				heartbeatStreamingThinkingBlockId: undefined,
				streamingThinkingBlockId: undefined,
				pendingPromptStart: false,
				queuedPrompts: [],
				nextId: maxId + 1,
				transcriptVersion: state.transcriptVersion + 1,
			};
		}
		case "start_compacting":
			return { ...state, compacting: true, pendingPromptStart: false };
		case "finish_compacting":
			return {
				...state,
				compacting: false,
				messages: [
					...state.messages,
					{
						id: state.nextId,
						role: "info" as const,
						text: COMPACT_BOUNDARY_TEXT,
						variant: "compact_boundary" as const,
					},
				],
				pendingPromptStart: false,
				nextId: state.nextId + 1,
			};
		case "noop":
		case "session_menu":
			return state;
	}
}

function queuePendingPromptStart(state: TuiState): TuiState {
	if (!state.pendingPromptStart) {
		return state;
	}

	const pendingPrompt = state.messages.at(-1);
	if (pendingPrompt?.role !== "user") {
		return {
			...state,
			pendingPromptStart: false,
		};
	}

	return {
		...state,
		messages: state.messages.slice(0, -1),
		pendingPromptStart: false,
		queuedPrompts: [
			{ id: pendingPrompt.id, text: pendingPrompt.text },
			...state.queuedPrompts,
		],
	};
}

function confirmTuiPrompt(
	state: TuiState,
	action: Extract<TuiAction, { type: "confirm_tui_prompt" }>,
): TuiState {
	const lastMessage = state.messages.at(-1);
	const pendingState =
		state.pendingPromptStart &&
		lastMessage?.role === "user" &&
		lastMessage.text !== action.text
			? queuePendingPromptStart(state)
			: state;

	const [queuedPrompt, ...queuedPrompts] = pendingState.queuedPrompts;
	if (queuedPrompt?.text === action.text) {
		return {
			...pendingState,
			activePrompt: {
				id: queuedPrompt.id,
				role: "user",
				text: action.text,
				replyText: action.replyText,
			},
			compacting: action.compacting,
			queuedPrompts,
			pendingPromptStart: false,
			running: true,
		};
	}

	const pendingLastMessage = pendingState.messages.at(-1);
	if (
		pendingLastMessage?.role === "user" &&
		pendingLastMessage.text === action.text
	) {
		return {
			...pendingState,
			compacting: action.compacting,
			pendingPromptStart: false,
			running: true,
		};
	}

	return {
		...pendingState,
		activePrompt: {
			id: pendingState.nextId,
			role: "user",
			text: action.text,
			replyText: action.replyText,
		},
		compacting: action.compacting,
		nextId: pendingState.nextId + 1,
		pendingPromptStart: false,
		running: true,
	};
}
