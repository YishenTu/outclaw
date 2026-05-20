import type { ReactNode } from "react";
import type {
	DisplayChatMessage,
	DisplayMessage,
} from "../../../../common/protocol.ts";

export type TranscriptItem =
	| {
			kind: "message";
			key: string;
			message: DisplayMessage;
			queued?: boolean;
			scrollKey?: string;
			showUtilityBar?: boolean;
	  }
	| {
			kind: "thinking";
			key: string;
			content: string;
			scrollKey?: string;
	  }
	| {
			kind: "activity";
			key: string;
			isCompacting?: boolean;
			isWorking?: boolean;
			scrollKey?: string;
			startedAt: number | null;
	  }
	| {
			kind: "tool";
			key: string;
			node: ReactNode;
			scrollKey?: string;
	  }
	| {
			kind: "error";
			key: string;
			message: string;
			scrollKey?: string;
	  };

export function transcriptItemScrollKey(item: TranscriptItem): string {
	return item.scrollKey ?? `${item.kind}:${item.key}`;
}

export function displayMessageKey(message: DisplayMessage): string {
	if (message.kind === "system") {
		return `system:${message.event}:${message.text}`;
	}

	return [
		"chat",
		message.role,
		message.content,
		message.replyContext?.text ?? "",
		message.thinking ?? "",
		message.thinkingBlocks?.join("\u0002") ?? "",
		String(message.timestamp ?? ""),
		message.images
			?.map((image) =>
				image.kind === "managed"
					? image.path
					: image.kind === "inline"
						? `${image.mediaType}:${image.base64.length}`
						: image.mediaType,
			)
			.join("|") ?? "",
	].join(":");
}

export function displayMessageRenderKey(params: {
	message: DisplayMessage;
	index: number;
	sessionKey: string | null;
}): string {
	return [
		params.sessionKey ?? "",
		params.index,
		displayMessageKey(params.message),
	].join("\u0003");
}

export function assistantTranscriptMessage(
	content: string,
	footer?: {
		durationMs?: number;
		timestamp: number;
	},
): DisplayChatMessage {
	const base: DisplayChatMessage = {
		kind: "chat",
		role: "assistant",
		content,
	};
	if (!footer) {
		return base;
	}
	return {
		...base,
		timestamp: footer.timestamp,
		assistantTurn: {
			source: "user",
			...(footer.durationMs !== undefined
				? { durationMs: footer.durationMs }
				: {}),
		},
	};
}
