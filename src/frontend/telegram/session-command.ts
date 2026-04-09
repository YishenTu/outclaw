interface TelegramSessionCommandEvent {
	type: string;
	[key: string]: unknown;
}

export interface TelegramSessionCommandRequest {
	command: string;
	expectedTypes: ReadonlySet<string>;
	showMenu: boolean;
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
			showMenu: true,
		};
	}

	const firstToken = trimmed.split(/\s+/, 1)[0];
	const expectedTypes =
		firstToken === "list"
			? new Set(["session_list"])
			: firstToken === "delete"
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
