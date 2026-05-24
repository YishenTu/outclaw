import type { BrowserCodingSessionSummary } from "../../../common/protocol.ts";
import {
	type ProviderSessionRef,
	providerSessionRefKey,
	providerSessionRefsEqual,
} from "../../../common/provider-session-ref.ts";

export type CodingSessionRef = ProviderSessionRef;

export function codingSessionRefKey(ref: CodingSessionRef): string {
	return providerSessionRefKey(ref);
}

export function matchesCodingSession(ref: CodingSessionRef) {
	return (session: CodingSessionRef): boolean =>
		providerSessionRefsEqual(session, ref);
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
	const matches = matchesCodingSession(session);
	let replaced = false;
	const sessions = existing.map((candidate) => {
		if (!matches(candidate)) {
			return candidate;
		}
		replaced = true;
		return session;
	});
	return sortCodingSessionsByLastActive(
		replaced ? sessions : [session, ...existing],
	);
}

export function sortCodingSessionsByLastActive(
	sessions: BrowserCodingSessionSummary[],
): BrowserCodingSessionSummary[] {
	return sessions
		.map((session, index) => ({ index, session }))
		.sort((left, right) => {
			const activeDelta = right.session.lastActive - left.session.lastActive;
			return activeDelta === 0 ? left.index - right.index : activeDelta;
		})
		.map((entry) => entry.session);
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
