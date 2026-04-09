export interface SessionMenuChoice {
	sdkSessionId: string;
	title: string;
	model: string;
	lastActive: number;
	active: boolean;
}

export function sessionMenuChoices(
	sessions: Array<{
		sdkSessionId: string;
		title: string;
		model: string;
		lastActive: number;
	}>,
	activeSessionId: string | undefined,
): SessionMenuChoice[] {
	const items: SessionMenuChoice[] = [];
	for (const session of sessions) {
		items.push({
			sdkSessionId: session.sdkSessionId,
			title: session.title,
			model: session.model,
			lastActive: session.lastActive,
			active: session.sdkSessionId === activeSessionId,
		});
	}
	return items;
}

export function formatTimeAgo(timestamp: number): string {
	const seconds = Math.floor((Date.now() - timestamp) / 1000);
	if (seconds < 5) return "just now";
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

export function formatSessionMenuItem(
	choice: SessionMenuChoice,
	width: number,
): string {
	const safeWidth = Math.max(width, 0);
	if (safeWidth === 0) {
		return "";
	}

	const ago = formatTimeAgo(choice.lastActive);
	const marker = choice.active ? " ●" : "";
	const right = `${ago}${marker}`;
	if (safeWidth <= right.length) {
		return right.slice(0, safeWidth);
	}

	const gap = 2;
	const maxTitle = Math.max(safeWidth - right.length - gap, 0);

	let title = choice.title;
	if (title.length > maxTitle) {
		title =
			maxTitle <= 3
				? title.slice(0, maxTitle)
				: `${title.slice(0, maxTitle - 3)}...`;
	}

	const padding = Math.max(safeWidth - title.length - right.length, 0);
	return `${title}${" ".repeat(padding)}${right}`;
}
