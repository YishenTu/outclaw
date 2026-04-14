import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { theme } from "../chrome/theme.ts";
import { useTerminalInput } from "../composer/input.ts";
import type { AgentSummary } from "./types.ts";

interface AgentMenuProps {
	activeAgentId: string;
	agents: AgentSummary[];
	onDismiss: () => void;
	onSelect: (agent: AgentSummary) => void;
}

export function AgentMenu({
	activeAgentId,
	agents,
	onDismiss,
	onSelect,
}: AgentMenuProps) {
	const [cursor, setCursor] = useState(0);

	useEffect(() => {
		if (cursor >= agents.length && agents.length > 0) {
			setCursor(agents.length - 1);
		}
	}, [agents.length, cursor]);

	useTerminalInput(({ key }) => {
		if (agents.length === 0) {
			if (key.escape) {
				onDismiss();
			}
			return;
		}
		if (key.escape) {
			onDismiss();
			return;
		}
		if (key.return) {
			const agent = agents[cursor];
			if (agent) {
				onSelect(agent);
			}
			return;
		}
		if (key.upArrow) {
			setCursor((previous) =>
				previous > 0 ? previous - 1 : agents.length - 1,
			);
		}
		if (key.downArrow) {
			setCursor((previous) =>
				previous < agents.length - 1 ? previous + 1 : 0,
			);
		}
	}, true);

	return (
		<Box flexDirection="column">
			<Text bold>Agents</Text>
			{agents.map((agent, index) => {
				const pointer = index === cursor ? "▸ " : "  ";
				const label =
					agent.agentId === activeAgentId
						? `${agent.name} (active)`
						: agent.name;
				return (
					<Text
						key={agent.agentId}
						color={index === cursor ? theme.accent : undefined}
					>
						{pointer}
						{label}
					</Text>
				);
			})}
			<Text dimColor>Enter select · Esc dismiss</Text>
		</Box>
	);
}
