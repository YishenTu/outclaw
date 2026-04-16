export function formatLastActive(lastActive: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.floor((now - lastActive) / 1000));
	if (seconds < 5) {
		return "1m";
	}

	const minutes = Math.max(1, Math.floor(seconds / 60));
	if (minutes < 60) {
		return `${minutes}m`;
	}

	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours}h`;
	}

	return `${Math.floor(hours / 24)}d`;
}
