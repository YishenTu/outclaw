import { describe, expect, test } from "bun:test";
import {
	createLiveRunSessionRouter,
	pinLiveRunSessionKey,
	routeLiveRunSessionKey,
} from "../../../src/frontend/browser/events/live-run-session.ts";

describe("browser live run session router", () => {
	test("keeps a run pinned to the session where it started", () => {
		const router = createLiveRunSessionRouter();
		const existingSessionKey = "agent-a:claude:sdk-existing";
		const pendingSessionKey = "agent-a:claude:__pending__";

		router.pin(existingSessionKey);

		expect(router.route(pendingSessionKey)).toBe(existingSessionKey);
		expect(router.complete(existingSessionKey, pendingSessionKey)).toEqual({
			sessionKey: existingSessionKey,
		});
		expect(router.route(pendingSessionKey)).toBe(pendingSessionKey);
	});

	test("adopts a pending run into its final session key on completion", () => {
		const router = createLiveRunSessionRouter();
		const pendingSessionKey = "agent-a:claude:__pending__";
		const nextSessionKey = "agent-a:claude:sdk-next";

		router.pin(pendingSessionKey);

		expect(router.complete(nextSessionKey, pendingSessionKey)).toEqual({
			sessionKey: nextSessionKey,
			adoptFromSessionKey: pendingSessionKey,
		});
	});

	test("falls back to the current session key when no run was pinned", () => {
		const router = createLiveRunSessionRouter();
		const pendingSessionKey = "agent-a:claude:__pending__";
		const nextSessionKey = "agent-a:claude:sdk-next";

		expect(router.complete(nextSessionKey, pendingSessionKey)).toEqual({
			sessionKey: nextSessionKey,
			adoptFromSessionKey: pendingSessionKey,
		});
	});

	test("clears the pinned run explicitly", () => {
		const router = createLiveRunSessionRouter();
		const existingSessionKey = "agent-a:claude:sdk-existing";
		const pendingSessionKey = "agent-a:claude:__pending__";

		router.pin(existingSessionKey);
		router.clear();

		expect(router.route(pendingSessionKey)).toBe(pendingSessionKey);
	});

	test("does not adopt another real session when a late done arrives without a pin", () => {
		const router = createLiveRunSessionRouter();
		const existingSessionKey = "agent-a:claude:sdk-existing";
		const switchedSessionKey = "agent-a:claude:sdk-switched";

		expect(router.complete(existingSessionKey, switchedSessionKey)).toEqual({
			sessionKey: existingSessionKey,
		});
	});

	test("pins late observed events to their explicit session id after a session switch", () => {
		const router = createLiveRunSessionRouter();
		const existingSessionKey = "agent-a:claude:sdk-existing";
		const switchedSessionKey = "agent-a:claude:sdk-switched";

		expect(
			pinLiveRunSessionKey({
				agentId: "agent-a",
				fallbackSessionKey: switchedSessionKey,
				observedSessionId: "sdk-existing",
				providerId: "claude",
				router,
			}),
		).toBe(existingSessionKey);
		expect(
			routeLiveRunSessionKey({
				agentId: "agent-a",
				fallbackSessionKey: switchedSessionKey,
				observedSessionId: "sdk-existing",
				providerId: "claude",
				router,
			}),
		).toBe(existingSessionKey);
		expect(router.complete(existingSessionKey, switchedSessionKey)).toEqual({
			sessionKey: existingSessionKey,
		});
	});
});
