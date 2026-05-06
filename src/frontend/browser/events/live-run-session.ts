import {
	createBrowserSessionRef,
	createSessionKey,
	PENDING_SESSION_ID,
} from "../sessions/session.ts";

export interface LiveRunCompletion {
	sessionKey: string;
	adoptFromSessionKey?: string;
}

export interface LiveRunSessionRouter {
	bind: (sessionKey: string, fallbackSessionKey: string) => LiveRunCompletion;
	clear: () => void;
	complete: (
		sessionKey: string,
		fallbackSessionKey: string,
	) => LiveRunCompletion;
	pin: (sessionKey: string) => string;
	route: (fallbackSessionKey: string) => string;
}

export function createLiveRunSessionRouter(): LiveRunSessionRouter {
	let pinnedSessionKey: string | null = null;

	return {
		bind: (sessionKey, fallbackSessionKey) => {
			const routedSessionKey = pinnedSessionKey ?? fallbackSessionKey;
			if (routedSessionKey === sessionKey) {
				pinnedSessionKey = sessionKey;
				return { sessionKey };
			}
			if (isPendingSessionKey(routedSessionKey)) {
				pinnedSessionKey = sessionKey;
				return {
					sessionKey,
					adoptFromSessionKey: routedSessionKey,
				};
			}
			if (pinnedSessionKey === null) {
				pinnedSessionKey = sessionKey;
				return { sessionKey };
			}
			return { sessionKey: routedSessionKey };
		},
		clear: () => {
			pinnedSessionKey = null;
		},
		complete: (sessionKey, fallbackSessionKey) => {
			const routedSessionKey = pinnedSessionKey ?? fallbackSessionKey;
			pinnedSessionKey = null;
			return routedSessionKey === sessionKey
				? { sessionKey }
				: isPendingSessionKey(routedSessionKey)
					? {
							sessionKey,
							adoptFromSessionKey: routedSessionKey,
						}
					: { sessionKey };
		},
		pin: (sessionKey) => {
			pinnedSessionKey = sessionKey;
			return sessionKey;
		},
		route: (fallbackSessionKey) => pinnedSessionKey ?? fallbackSessionKey,
	};
}

export function pinLiveRunSessionKey(params: {
	agentId: string;
	fallbackSessionKey: string;
	observedSessionId?: string;
	providerId?: string | null;
	router: Pick<LiveRunSessionRouter, "pin">;
}): string {
	const observedSessionKey = resolveObservedSessionKey(params);
	if (observedSessionKey) {
		params.router.pin(observedSessionKey);
		return observedSessionKey;
	}

	return params.router.pin(params.fallbackSessionKey);
}

export function routeLiveRunSessionKey(params: {
	agentId: string;
	fallbackSessionKey: string;
	observedSessionId?: string;
	providerId?: string | null;
	router: Pick<LiveRunSessionRouter, "pin" | "route">;
}): string {
	const observedSessionKey = resolveObservedSessionKey(params);
	if (observedSessionKey) {
		params.router.pin(observedSessionKey);
		return observedSessionKey;
	}

	return params.router.route(params.fallbackSessionKey);
}

function resolveObservedSessionKey(params: {
	agentId: string;
	observedSessionId?: string;
	providerId?: string | null;
}): string | undefined {
	if (!params.providerId || !params.observedSessionId) {
		return undefined;
	}

	return createSessionKey(
		createBrowserSessionRef(
			params.agentId,
			params.providerId,
			params.observedSessionId,
		),
	);
}

function isPendingSessionKey(sessionKey: string): boolean {
	return sessionKey.endsWith(`:${PENDING_SESSION_ID}`);
}
