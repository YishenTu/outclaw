import type { SessionEntry } from "../../stores/sessions.ts";

export type SessionGroupKey =
	| "today"
	| "lastSevenDays"
	| "lastThirtyDays"
	| "older";

export interface GroupedSessions {
	today: SessionEntry[];
	lastSevenDays: SessionEntry[];
	lastThirtyDays: SessionEntry[];
	older: SessionEntry[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function groupSessionsByAge(
	sessions: SessionEntry[],
	now = Date.now(),
): GroupedSessions {
	const grouped: GroupedSessions = {
		today: [],
		lastSevenDays: [],
		lastThirtyDays: [],
		older: [],
	};

	for (const session of sessions) {
		grouped[classifySessionAge(session.lastActive, now)].push(session);
	}

	return grouped;
}

export function classifySessionAge(
	lastActive: number,
	now = Date.now(),
): SessionGroupKey {
	const activeAt = Math.min(lastActive, now);
	if (activeAt >= startOfLocalDay(now)) {
		return "today";
	}
	const age = now - activeAt;
	if (age < 7 * DAY_MS) {
		return "lastSevenDays";
	}
	if (age < 30 * DAY_MS) {
		return "lastThirtyDays";
	}
	return "older";
}

function startOfLocalDay(timestamp: number): number {
	const date = new Date(timestamp);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}
