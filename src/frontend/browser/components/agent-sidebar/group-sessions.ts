import type { SessionEntry } from "../../stores/sessions.ts";

export type SessionGroupKey = "today" | "week" | "month" | "older";

export interface GroupedSessions {
	today: SessionEntry[];
	week: SessionEntry[];
	month: SessionEntry[];
	older: SessionEntry[];
}

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
	const activeAt = Math.min(lastActive, now);
	if (activeAt >= startOfLocalDay(now)) {
		return "today";
	}
	if (activeAt >= startOfLocalWeek(now)) {
		return "week";
	}
	if (activeAt >= startOfLocalMonth(now)) {
		return "month";
	}
	return "older";
}

function startOfLocalDay(timestamp: number): number {
	const date = new Date(timestamp);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}

function startOfLocalWeek(timestamp: number): number {
	const date = new Date(startOfLocalDay(timestamp));
	const daysSinceMonday = (date.getDay() + 6) % 7;
	date.setDate(date.getDate() - daysSinceMonday);
	return date.getTime();
}

function startOfLocalMonth(timestamp: number): number {
	const date = new Date(timestamp);
	return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}
