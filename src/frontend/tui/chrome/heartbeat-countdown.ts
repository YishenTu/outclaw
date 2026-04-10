export function formatHeartbeatCountdown(ms: number): string {
	if (ms <= 0) {
		return "0m";
	}

	if (ms < 60 * 60_000) {
		return `${Math.ceil(ms / 60_000)}m`;
	}

	const hours = Math.floor(ms / (60 * 60_000));
	const minutes = Math.floor((ms % (60 * 60_000)) / 60_000);

	return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
}

export function getHeartbeatCountdownLabel(
	nextHeartbeatAt: number | undefined,
	now: number,
	deferred: boolean,
): string | undefined {
	if (nextHeartbeatAt === undefined) {
		return undefined;
	}

	if (deferred) {
		return "♥ defer";
	}

	return `♥ ${formatHeartbeatCountdown(nextHeartbeatAt - now)}`;
}
