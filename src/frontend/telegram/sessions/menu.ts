import { TELEGRAM_SESSION_PAGE_SIZE } from "./command.ts";

export function formatTimeCompact(timestamp: number): string {
	const seconds = Math.floor((Date.now() - timestamp) / 1000);
	if (seconds < 5) return "now";
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	return `${days}d`;
}

export interface SessionButtonRow {
	label: string;
	switchData: string;
}

export interface SessionCallbackAction {
	mode?: "list" | "search";
	page?: number;
	sdkSessionId?: string;
	type: "noop" | "page" | "switch";
}

export interface SessionPageButton {
	label: string;
	data: string;
}

export interface SessionPageView {
	rows: SessionPageButton[][];
	text: string;
}

export function buildSessionButtons(
	sessions: Array<{
		sdkSessionId: string;
		title: string;
		lastActive: number;
	}>,
	activeSessionId?: string,
): SessionButtonRow[] {
	return sessions.map((session) => {
		const marker = session.sdkSessionId === activeSessionId ? " ●" : "";
		return {
			label: `${session.title}${marker}`,
			switchData: `ss:${session.sdkSessionId}`,
		};
	});
}

export function buildSessionPageView(params: {
	activeSessionId?: string;
	mode: "list" | "search";
	nextCursor?: unknown;
	page: number;
	query?: string;
	sessions: Array<{
		sdkSessionId: string;
		title: string;
		lastActive: number;
	}>;
}): SessionPageView {
	const page = Math.max(0, params.page);
	const start = page * TELEGRAM_SESSION_PAGE_SIZE;
	const pageSessions = params.sessions.slice(
		start,
		start + TELEGRAM_SESSION_PAGE_SIZE,
	);
	const rows = buildSessionButtons(pageSessions, params.activeSessionId).map(
		(row) => [{ label: row.label, data: row.switchData }],
	);
	const hasPrevious = page > 0;
	const hasNext =
		params.sessions.length > start + TELEGRAM_SESSION_PAGE_SIZE ||
		params.nextCursor !== undefined;
	const loadedPages = Math.ceil(
		(params.sessions.length + (params.nextCursor === undefined ? 0 : 1)) /
			TELEGRAM_SESSION_PAGE_SIZE,
	);
	const totalPages = Math.max(page + 1, loadedPages, 1);
	const footer: SessionPageButton[] = [];
	if (hasPrevious) {
		footer.push({
			label: "Prev",
			data: pageCallbackData(params.mode, page - 1),
		});
	}
	footer.push({
		label: `${page + 1}/${totalPages}${params.nextCursor ? "+" : ""}`,
		data: "sn",
	});
	if (hasNext) {
		footer.push({
			label: "Next",
			data: pageCallbackData(params.mode, page + 1),
		});
	}
	rows.push(footer);

	const query = params.query?.trim();
	const header =
		params.mode === "search" && query
			? `Session search: ${normalizeSearchHeaderQuery(query)}`
			: "Sessions:";
	const emptyText = params.mode === "search" ? "No matches" : "No sessions";
	return {
		rows,
		text:
			pageSessions.length === 0
				? `${header}\n${emptyText}`
				: `${header}\n${pageSessions
						.map((session) => `• ${session.title}`)
						.join("\n")}`,
	};
}

export function parseSessionCallback(
	data: string,
): SessionCallbackAction | undefined {
	if (data === "sn") {
		return { type: "noop" };
	}
	if (data.startsWith("sl:")) {
		const page = parsePage(data.slice(3));
		return page === undefined
			? undefined
			: { type: "page", mode: "list", page };
	}
	if (data.startsWith("sq:")) {
		const page = parsePage(data.slice(3));
		return page === undefined
			? undefined
			: { type: "page", mode: "search", page };
	}
	if (data.startsWith("ss:")) {
		return { type: "switch", sdkSessionId: data.slice(3) };
	}
	return undefined;
}

export function extractSearchQueryFromSessionPageText(
	text: string | undefined,
): string | undefined {
	const firstLine = text?.split(/\r?\n/, 1)[0]?.trim();
	const prefix = "Session search:";
	if (!firstLine?.startsWith(prefix)) {
		return undefined;
	}
	const query = firstLine.slice(prefix.length).trim();
	return query === "" ? undefined : query;
}

function pageCallbackData(mode: "list" | "search", page: number): string {
	return mode === "search" ? `sq:${page}` : `sl:${page}`;
}

function parsePage(raw: string): number | undefined {
	const page = Number.parseInt(raw, 10);
	return Number.isInteger(page) && page >= 0 && String(page) === raw
		? page
		: undefined;
}

function normalizeSearchHeaderQuery(query: string): string {
	return query.replace(/\s+/g, " ");
}
