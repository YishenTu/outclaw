import {
	createLiveRunSessionRouter,
	pinLiveRunSessionKey,
	routeLiveRunSessionKey,
} from "./live-run-session.ts";

interface BrowserLiveRunBridgeParams {
	getCurrentSessionKey: (agentId: string) => string;
	getProviderId: () => string | null | undefined;
}

export function createBrowserLiveRunBridge({
	getCurrentSessionKey,
	getProviderId,
}: BrowserLiveRunBridgeParams) {
	const router = createLiveRunSessionRouter();

	return {
		bindLiveRunSession: (nextSessionKey: string, currentSessionKey: string) =>
			router.bind(nextSessionKey, currentSessionKey),
		clearLiveRunSessions: () => {
			router.clear();
		},
		completeLiveRunSession: (
			nextSessionKey: string,
			currentSessionKey: string,
		) => router.complete(nextSessionKey, currentSessionKey),
		pinObservedSessionKey: (agentId: string, observedSessionId?: string) =>
			pinLiveRunSessionKey({
				agentId,
				fallbackSessionKey: getCurrentSessionKey(agentId),
				observedSessionId,
				providerId: getProviderId(),
				router,
			}),
		pinSession: (sessionKey: string) => {
			router.pin(sessionKey);
		},
		routeObservedSessionKey: (agentId: string, observedSessionId?: string) =>
			routeLiveRunSessionKey({
				agentId,
				fallbackSessionKey: getCurrentSessionKey(agentId),
				observedSessionId,
				providerId: getProviderId(),
				router,
			}),
	};
}
