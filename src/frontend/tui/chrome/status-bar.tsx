import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { getHeartbeatCountdownLabel } from "./heartbeat-countdown.ts";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

const statusColor: Record<ConnectionStatus, string> = {
	connecting: "yellow",
	connected: "green",
	disconnected: "red",
};

export interface RuntimeInfo {
	model?: string;
	effort?: string;
	contextPercentage?: number;
	nextHeartbeatAt?: number;
	heartbeatDeferred?: boolean;
}

interface StatusBarProps {
	status: ConnectionStatus;
	info: RuntimeInfo;
}

function useHeartbeatCountdown(
	nextHeartbeatAt: number | undefined,
	deferred: boolean,
): string | undefined {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (nextHeartbeatAt === undefined) {
			return;
		}

		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, [nextHeartbeatAt]);

	return getHeartbeatCountdownLabel(nextHeartbeatAt, now, deferred);
}

export function StatusBar({ status, info }: StatusBarProps) {
	const heartbeat = useHeartbeatCountdown(
		info.nextHeartbeatAt,
		info.heartbeatDeferred ?? false,
	);
	const parts: string[] = [];
	if (info.model) parts.push(info.model);
	if (info.effort) parts.push(info.effort);
	if (info.contextPercentage !== undefined) {
		parts.push(`${info.contextPercentage}% context`);
	}
	if (heartbeat) parts.push(heartbeat);

	return (
		<Box>
			<Text color={statusColor[status]}>● </Text>
			<Text dimColor>{status}</Text>
			{parts.length > 0 ? (
				<Text dimColor>{` · ${parts.join(" · ")}`}</Text>
			) : null}
		</Box>
	);
}
