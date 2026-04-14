import type { RuntimeStatusEvent } from "./protocol.ts";

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 3)}...`;
}

export function formatCompact(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return String(n);
}

export function formatHeartbeatCountdown(ms: number): string {
	if (ms <= 0) return "0m";
	if (ms < 60 * 60_000) return `${Math.ceil(ms / 60_000)}m`;
	const hours = Math.floor(ms / (60 * 60_000));
	const minutes = Math.floor((ms % (60 * 60_000)) / 60_000);
	return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
}

export function getHeartbeatLabel(
	nextHeartbeatAt: number | undefined,
	now: number,
	deferred: boolean,
): string | undefined {
	if (nextHeartbeatAt === undefined) return undefined;
	if (deferred) return "defer";
	return formatHeartbeatCountdown(nextHeartbeatAt - now);
}

export function formatContext(
	usage:
		| { contextTokens: number; contextWindow: number; percentage: number }
		| undefined,
): string {
	if (!usage) return "n/a";
	return `${formatCompact(usage.contextTokens)}/${formatCompact(usage.contextWindow)} (${usage.percentage}%)`;
}

function statusRows(
	event: RuntimeStatusEvent,
	now?: number,
): [string, string][] {
	const rows: [string, string][] = [
		["session", truncate(event.sessionTitle ?? event.sessionId ?? "none", 40)],
	];
	if (event.agentName) {
		rows.push(["agent", event.agentName]);
	}
	rows.push(
		["model", event.model],
		["effort", event.effort],
		["context", formatContext(event.usage)],
	);
	const heartbeat = getHeartbeatLabel(
		event.nextHeartbeatAt,
		now ?? Date.now(),
		event.heartbeatDeferred ?? false,
	);
	if (heartbeat) {
		rows.push(["heartbeat", heartbeat]);
	}
	return rows;
}

export function formatStatus(event: RuntimeStatusEvent, now?: number): string {
	const rows = statusRows(event, now);
	const maxLabel = Math.max(...rows.map(([label]) => label.length));
	const body = rows
		.map(([label, value]) => `${label.padEnd(maxLabel)}  ${value}`)
		.join("\n");
	return `Status\n${body}`;
}

export function formatStatusCompact(
	event: RuntimeStatusEvent,
	now?: number,
): string {
	const rows = statusRows(event, now);
	const body = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
	return `Status\n${body}`;
}
