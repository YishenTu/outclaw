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
	type: "switch";
	sdkSessionId: string;
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

export function parseSessionCallback(
	data: string,
): SessionCallbackAction | undefined {
	if (data.startsWith("ss:")) {
		return { type: "switch", sdkSessionId: data.slice(3) };
	}
	return undefined;
}
