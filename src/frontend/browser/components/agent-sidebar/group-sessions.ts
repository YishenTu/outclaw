import type { SessionEntry } from "../../stores/sessions.ts";

export type SessionGroupKey = "today" | "week" | "month" | "older";

export interface GroupedSessions {
	today: SessionEntry[];
	week: SessionEntry[];
	month: SessionEntry[];
	older: SessionEntry[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function groupSessionsByAge(
	sessions: SessionEntry[],
	now = Date.now(),
): GroupedSessions {
	const grouped: GroupedSessions = {
		today: [],
		week: [],
		month: [],
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
	const age = Math.max(0, now - lastActive);
	if (age < DAY_MS) {
		return "today";
	}
	if (age < 7 * DAY_MS) {
		return "week";
	}
	if (age < 30 * DAY_MS) {
		return "month";
	}
	return "older";
}
