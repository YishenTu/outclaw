import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { formatCompact, getHeartbeatLabel } from "../../../common/status.ts";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

const statusColor: Record<ConnectionStatus, string> = {
	connecting: "yellow",
	connected: "green",
	disconnected: "red",
};

export interface RuntimeInfo {
	agentName?: string;
	model?: string;
	effort?: string;
	notice?: string;
	contextTokens?: number;
	contextWindow?: number;
	nextHeartbeatAt?: number;
	heartbeatDeferred?: boolean;
}

interface StatusBarProps {
	status: ConnectionStatus;
	info: RuntimeInfo;
	notice?: string;
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

	return getHeartbeatLabel(nextHeartbeatAt, now, deferred);
}

export function contextWarningColor(percentage: number): string | undefined {
	if (percentage >= 75) return "red";
	if (percentage >= 65) return "yellow";
	return undefined;
}

export function StatusBar({ status, info, notice }: StatusBarProps) {
	const heartbeat = useHeartbeatCountdown(
		info.nextHeartbeatAt,
		info.heartbeatDeferred ?? false,
	);
	const parts: string[] = [];
	if (info.agentName) parts.push(`@${info.agentName}`);
	if (info.model) parts.push(info.model);
	if (info.effort) parts.push(info.effort);

	let contextLabel: string | undefined;
	let contextColor: string | undefined;
	if (info.contextTokens !== undefined && info.contextWindow !== undefined) {
		const pct =
			info.contextWindow > 0
				? Math.round((info.contextTokens / info.contextWindow) * 100)
				: 0;
		contextLabel = `${formatCompact(info.contextTokens)}/${formatCompact(info.contextWindow)} (${pct}%)`;
		contextColor = contextWarningColor(pct);
	}
	return (
		<Box width="100%" justifyContent="space-between">
			<Box>
				<Text color={statusColor[status]}>● </Text>
				<Text dimColor>{status}</Text>
				{parts.length > 0 ? (
					<Text dimColor>{` · ${parts.join(" · ")}`}</Text>
				) : null}
				{contextLabel ? (
					<Text dimColor={!contextColor} color={contextColor}>
						{` · ${contextLabel}`}
					</Text>
				) : null}
				{heartbeat ? <Text dimColor>{` · ♥ ${heartbeat}`}</Text> : null}
			</Box>
			{notice ? (
				<Box marginLeft={1}>
					<Text color="yellow">{notice}</Text>
				</Box>
			) : null}
		</Box>
	);
}
