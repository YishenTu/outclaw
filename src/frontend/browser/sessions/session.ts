import { PENDING_SESSION_TITLE } from "../../../common/session-title.ts";
import type { SessionRef } from "../stores/sessions.ts";

export const PENDING_SESSION_ID = "__pending__";
export const PENDING_PROVIDER_ID = "runtime";
export { PENDING_SESSION_TITLE };

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

export function resolveCurrentBrowserSessionKey(params: {
	agentId: string;
	activeSession: SessionRef | null;
	providerId?: string | null;
	runtimeSessionId?: string | null;
}): string {
	if (params.providerId && params.runtimeSessionId) {
		return createSessionKey(
			createBrowserSessionRef(
				params.agentId,
				params.providerId,
				params.runtimeSessionId,
			),
		);
	}

	return resolveBrowserSessionKey(params);
}

export function resolveComposerSessionKey(params: {
	agentId: string;
	activeSession: SessionRef | null;
	providerId?: string | null;
	preferRuntimeSession?: boolean;
	runtimeSessionId?: string | null;
}): string {
	if (params.preferRuntimeSession === false) {
		return resolveBrowserSessionKey(params);
	}
	return resolveCurrentBrowserSessionKey(params);
}

export function resolveDisplayedAgentSessionKey(params: {
	agentId: string;
	agentName: string;
	activeSession: SessionRef | null;
	providerId?: string | null;
	runtimeAgentName?: string | null;
	runtimeSessionId?: string | null;
}): string {
	return resolveComposerSessionKey({
		agentId: params.agentId,
		activeSession: params.activeSession,
		preferRuntimeSession: params.agentName === params.runtimeAgentName,
		providerId: params.providerId,
		runtimeSessionId: params.runtimeSessionId,
	});
}

export function resolveDisplayedSessionTitle(params: {
	activeSession: SessionRef | null;
	activeSessionTitle?: string | null;
	agentName: string;
	providerId?: string | null;
	runtimeAgentName?: string | null;
	runtimeSessionId?: string | null;
	sessionTitleFromRuntime?: string | null;
}): string {
	const runtimeOwnsDisplayedAgent =
		params.agentName === params.runtimeAgentName;
	if (
		runtimeOwnsDisplayedAgent &&
		params.sessionTitleFromRuntime !== undefined &&
		params.sessionTitleFromRuntime !== null
	) {
		return params.sessionTitleFromRuntime;
	}
	if (
		params.activeSessionTitle !== undefined &&
		params.activeSessionTitle !== null
	) {
		return params.activeSessionTitle;
	}
	if (!params.activeSession) {
		return PENDING_SESSION_TITLE;
	}
	if (
		runtimeOwnsDisplayedAgent &&
		params.providerId === params.activeSession.providerId &&
		params.runtimeSessionId === params.activeSession.sdkSessionId
	) {
		return PENDING_SESSION_TITLE;
	}
	return params.activeSession.sdkSessionId;
}
