import { describe, expect, test } from "bun:test";
import type { DisplayMessage } from "../../../src/common/protocol.ts";
import {
	chatImageKey,
	chatImageLabel,
	inlineChatImageSrc,
	shouldShowAssistantUtilityBar,
} from "../../../src/frontend/browser/components/chat/message-render-projection.ts";

describe("browser message render projection", () => {
	test("projects image keys, labels, and inline sources", () => {
		const image = {
			kind: "inline" as const,
			mediaType: "image/png" as const,
			base64: "abc",
		};

		expect(chatImageKey(image, 2)).toBe("inline:2");
		expect(chatImageLabel(2)).toBe("Image 3");
		expect(inlineChatImageSrc(image)).toBe("data:image/png;base64,abc");
		expect(
			inlineChatImageSrc({
				kind: "managed",
				path: "/tmp/image.png",
				mediaType: "image/png",
			}),
		).toBeUndefined();
	});

	test("shows assistant utility bars only for user-triggered assistant turns", () => {
		const userAssistant: DisplayMessage = {
			kind: "chat",
			role: "assistant",
			content: "done",
			assistantTurn: { source: "user", durationMs: 10 },
		};
		const heartbeatAssistant: DisplayMessage = {
			kind: "chat",
			role: "assistant",
			content: "done",
			assistantTurn: { source: "heartbeat", durationMs: 10 },
		};

		expect(shouldShowAssistantUtilityBar(userAssistant)).toBe(true);
		expect(shouldShowAssistantUtilityBar(heartbeatAssistant)).toBe(false);
		expect(
			shouldShowAssistantUtilityBar({
				kind: "chat",
				role: "user",
				content: "hello",
			}),
		).toBe(false);
	});
});
