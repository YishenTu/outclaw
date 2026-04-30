import { describe, expect, test } from "bun:test";
import { createBrowserLiveRunBridge } from "../../../src/frontend/browser/browser-live-run-bridge.ts";

describe("browser live run bridge", () => {
	test("pins observed events by provider session and completes through the same router", () => {
		const bridge = createBrowserLiveRunBridge({
			getCurrentSessionKey: () => "agent-a:claude:sdk-current",
			getProviderId: () => "claude",
		});

		expect(bridge.pinObservedSessionKey("agent-a", "sdk-observed")).toBe(
			"agent-a:claude:sdk-observed",
		);
		expect(bridge.routeObservedSessionKey("agent-a")).toBe(
			"agent-a:claude:sdk-observed",
		);
		expect(
			bridge.completeLiveRunSession(
				"agent-a:claude:sdk-observed",
				"agent-a:claude:sdk-current",
			),
		).toEqual({ sessionKey: "agent-a:claude:sdk-observed" });
	});

	test("adopts a pending fallback session into a final provider session", () => {
		const bridge = createBrowserLiveRunBridge({
			getCurrentSessionKey: () => "agent-a:claude:__pending__",
			getProviderId: () => "claude",
		});

		bridge.pinSession("agent-a:claude:__pending__");

		expect(
			bridge.completeLiveRunSession(
				"agent-a:claude:sdk-final",
				"agent-a:claude:__pending__",
			),
		).toEqual({
			adoptFromSessionKey: "agent-a:claude:__pending__",
			sessionKey: "agent-a:claude:sdk-final",
		});
	});
});
