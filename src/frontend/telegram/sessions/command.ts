interface TelegramSessionCommandEvent {
	type: string;
	[key: string]: unknown;
}

export interface TelegramSessionCommandRequest {
	command: string;
	expectedTypes: ReadonlySet<string>;
	renderMode?: "list" | "search";
	searchQuery?: string;
	showMenu: boolean;
}

export const TELEGRAM_SESSION_PAGE_SIZE = 5;
export const TELEGRAM_SESSION_PREFETCH_PAGES = 2;

export function sessionFetchLimitForPage(page: number): number {
	// Telegram callback_data is too small to carry cursors and search text, so page callbacks refetch the prefix needed to render the requested page.
	return (
		(Math.max(page, 0) + TELEGRAM_SESSION_PREFETCH_PAGES) *
		TELEGRAM_SESSION_PAGE_SIZE
	);
}

function formatError(event: TelegramSessionCommandEvent): string | undefined {
	return event.type === "error"
		? `[error] ${String(event.message ?? "")}`
		: undefined;
}

export function buildSessionCommandRequest(
	match?: string,
): TelegramSessionCommandRequest {
	const trimmed = match?.trim() ?? "";
	if (!trimmed) {
		return {
			command: "/session",
			expectedTypes: new Set(["session_menu"]),
			renderMode: "list",
			showMenu: true,
		};
	}

	const firstToken = trimmed.split(/\s+/, 1)[0];
	if (firstToken === "list") {
		return {
			command: `/session list ${sessionFetchLimitForPage(0)}`,
			expectedTypes: new Set(["session_list"]),
			renderMode: "list",
			showMenu: true,
		};
	}
	if (firstToken === "search") {
		const query = trimmed.slice("search".length).trim();
		return {
			command: `/session search --limit ${sessionFetchLimitForPage(0)} -- ${query}`,
			expectedTypes: new Set(["session_search_result"]),
			renderMode: "search",
			searchQuery: query,
			showMenu: true,
		};
	}

	const expectedTypes =
		firstToken === "delete"
			? new Set(["session_deleted"])
			: firstToken === "rename"
				? new Set(["session_renamed"])
				: new Set(["session_switched"]);

	return {
		command: `/session ${trimmed}`,
		expectedTypes,
		showMenu: false,
	};
}

export function formatSessionCommandReply(
	event: TelegramSessionCommandEvent,
): string | undefined {
	if (event.type === "session_list") {
		const sessions = event.sessions as Array<{
			sdkSessionId: string;
			title: string;
		}>;
		const list = sessions
			.map((session) => `${session.sdkSessionId.slice(0, 8)}  ${session.title}`)
			.join("\n");
		return list || "No sessions";
	}

	if (event.type === "session_switched") {
		return `Switched to: ${String(event.title)}`;
	}

	if (event.type === "session_deleted") {
		return `Deleted: ${String(event.sdkSessionId)}`;
	}

	if (event.type === "session_renamed") {
		return `Renamed: ${String(event.title)}`;
	}

	return formatError(event);
}
