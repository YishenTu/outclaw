import type { FacadeEvent } from "../../../common/protocol.ts";
import type { PiDriverEvent } from "./types.ts";

export function normalizePiStreamEvent(event: PiDriverEvent): FacadeEvent {
	switch (event.type) {
		case "session_started":
			return { type: "session_initialized", sessionId: event.sessionId };
		case "text_delta":
			return {
				type: "text",
				text: event.text,
				sessionId: event.sessionId,
				timestamp: event.timestamp,
			};
		case "thinking_delta":
			return {
				type: "thinking",
				text: event.text,
				blockId: event.blockId,
				sessionId: event.sessionId,
				timestamp: event.timestamp,
			};
		case "status":
			return {
				type: "status",
				message: event.message,
			};
		case "usage":
			return {
				type: "usage_updated",
				usage: event.usage,
				sessionId: event.sessionId,
			};
		case "turn_aborted":
			return {
				type: "turn_aborted",
				sessionId: event.sessionId,
				timestamp: event.timestamp,
			};
		case "compaction_started":
			return {
				type: "compacting_started",
				sessionId: event.sessionId,
			};
		case "compaction_finished":
			return {
				type: "compacting_finished",
				sessionId: event.sessionId,
			};
		case "tool_call_started":
			return {
				type: "tool_call_started",
				callId: event.callId,
				toolKind: event.toolKind,
				details: event.details,
				sessionId: event.sessionId,
			};
		case "tool_call_completed":
			return {
				type: "tool_call_completed",
				callId: event.callId,
				toolKind: event.toolKind,
				status: event.status,
				details: event.details,
				sessionId: event.sessionId,
			};
		case "error":
			return {
				type: "error",
				message: event.message,
				sessionId: event.sessionId,
			};
		case "done":
			return {
				type: "done",
				sessionId: event.sessionId,
				durationMs: event.durationMs,
				timestamp: event.timestamp,
				costUsd: event.costUsd,
				usage: event.usage,
			};
	}
}
