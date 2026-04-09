import { Box, Text } from "ink";

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
}

interface StatusBarProps {
	status: ConnectionStatus;
	info: RuntimeInfo;
}

export function StatusBar({ status, info }: StatusBarProps) {
	const parts: string[] = [];
	if (info.model) parts.push(info.model);
	if (info.effort) parts.push(info.effort);
	if (info.contextPercentage !== undefined) {
		parts.push(`${info.contextPercentage}% context`);
	}

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
