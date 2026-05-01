import { describe, expect, test } from "bun:test";
import { applyBrowserStatusEvent } from "../../../src/frontend/browser/events/browser-status-event.ts";

describe("browser status events", () => {
	test("renders inline status events into the current chat session", () => {
		const calls: string[] = [];

		applyBrowserStatusEvent({
			activeAgentId: "agent-a",
			closePopup: () => calls.push("closePopup"),
			event: {
				type: "status",
				message: "Request interrupted by user",
				presentation: "inline",
			},
			finalizeMessage: (sessionKey, options) => {
				calls.push(`finalize:${sessionKey}:${options?.timestamp}`);
			},
			now: () => 123,
			openStatus: (message) => calls.push(`popup:${message}`),
			pushMessage: (sessionKey, message) => {
				calls.push(
					`${sessionKey}:${message.kind}:${message.event}:${message.text}:${message.timestamp}`,
				);
			},
			resolveCurrentSessionKey: (agentId) => `${agentId}:claude:sdk-alpha`,
		});

		expect(calls).toEqual([
			"closePopup",
			"finalize:agent-a:claude:sdk-alpha:123",
			"agent-a:claude:sdk-alpha:system:status:Request interrupted by user:123",
		]);
	});

	test("keeps popup status events on the popup path", () => {
		const calls: string[] = [];

		applyBrowserStatusEvent({
			activeAgentId: "agent-a",
			closePopup: () => calls.push("closePopup"),
			event: {
				type: "status",
				message: "Status\nsession: Alpha",
			},
			finalizeMessage: (sessionKey) => calls.push(`finalize:${sessionKey}`),
			openStatus: (message) => calls.push(`popup:${message}`),
			pushMessage: (sessionKey, message) =>
				calls.push(`${sessionKey}:${message.kind}`),
			resolveCurrentSessionKey: (agentId) => `${agentId}:claude:sdk-alpha`,
		});

		expect(calls).toEqual(["popup:Status\nsession: Alpha"]);
	});
});
