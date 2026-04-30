import type { DisplayMessage } from "../../../../common/protocol.ts";

export type ChatImage = NonNullable<
	Extract<DisplayMessage, { kind: "chat" }>["images"]
>[number];

export function chatImageKey(image: ChatImage, index: number): string {
	return `${image.kind}:${index}`;
}

export function chatImageLabel(index: number): string {
	return `Image ${index + 1}`;
}

export function inlineChatImageSrc(image: ChatImage): string | undefined {
	return image.kind === "inline"
		? `data:${image.mediaType};base64,${image.base64}`
		: undefined;
}

export function shouldShowAssistantUtilityBar(
	message: DisplayMessage,
): boolean {
	return (
		message.kind === "chat" &&
		message.role === "assistant" &&
		message.assistantTurn?.source === "user"
	);
}
