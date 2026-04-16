import type { SessionRef } from "./stores/sessions.ts";

export const PENDING_SESSION_ID = "__pending__";
export const PENDING_PROVIDER_ID = "runtime";

export function createBrowserSessionRef(
	agentId: string,
	providerId: string,
	sdkSessionId: string,
): SessionRef {
	return {
		agentId,
		providerId,
		sdkSessionId,
	};
}

export function createPendingSessionRef(
	agentId: string,
	providerId = PENDING_PROVIDER_ID,
): SessionRef {
	return createBrowserSessionRef(agentId, providerId, PENDING_SESSION_ID);
}

export function createSessionKey(session: SessionRef): string {
	return `${session.agentId}:${session.providerId}:${session.sdkSessionId}`;
}

export function createPendingSessionKey(
	agentId: string,
	providerId = PENDING_PROVIDER_ID,
): string {
	return createSessionKey(createPendingSessionRef(agentId, providerId));
}

export function resolveBrowserSessionKey(params: {
	agentId: string;
	activeSession: SessionRef | null;
	providerId?: string | null;
}): string {
	return params.activeSession
		? createSessionKey(params.activeSession)
		: createPendingSessionKey(
				params.agentId,
				params.providerId ?? PENDING_PROVIDER_ID,
			);
}
