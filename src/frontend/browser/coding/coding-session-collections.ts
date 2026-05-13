import type { BrowserCodingSessionSummary } from "../../../common/protocol.ts";

export interface CodingSessionRef {
	providerId: string;
	sdkSessionId: string;
}

export function codingSessionRefKey(ref: CodingSessionRef): string {
	return `${ref.providerId}\u0000${ref.sdkSessionId}`;
}

export function matchesCodingSession(ref: CodingSessionRef) {
	const key = codingSessionRefKey(ref);
	return (session: CodingSessionRef): boolean =>
		codingSessionRefKey(session) === key;
}

export function mergeCodingSessions(
	existing: BrowserCodingSessionSummary[],
	incoming: BrowserCodingSessionSummary[],
): BrowserCodingSessionSummary[] {
	const seen = new Set(existing.map(codingSessionRefKey));
	const merged = [...existing];
	for (const session of incoming) {
		const key = codingSessionRefKey(session);
		if (seen.has(key)) {
			continue;
		}
		merged.push(session);
		seen.add(key);
	}
	return merged;
}

export function upsertCodingSession(
	existing: BrowserCodingSessionSummary[],
	session: BrowserCodingSessionSummary,
): BrowserCodingSessionSummary[] {
	return [session, ...removeCodingSession(existing, session)];
}

export function removeCodingSession<T extends CodingSessionRef>(
	sessions: T[],
	ref: CodingSessionRef,
): T[] {
	const matches = matchesCodingSession(ref);
	return sessions.filter((session) => !matches(session));
}

export function renameCodingSession(
	sessions: BrowserCodingSessionSummary[],
	ref: CodingSessionRef,
	title: string,
): BrowserCodingSessionSummary[] {
	const matches = matchesCodingSession(ref);
	return sessions.map((session) =>
		matches(session) ? { ...session, title } : session,
	);
}
