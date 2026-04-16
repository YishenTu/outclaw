import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { theme } from "../chrome/theme.ts";
import { useTerminalInput } from "../composer/input.ts";
import { useLatestRef } from "../use-latest-ref.ts";
import { clampAgentMenuCursor, reduceAgentMenuBatch } from "./state.ts";
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
	const cursorRef = useLatestRef(cursor);

	useEffect(() => {
		const nextCursor = clampAgentMenuCursor(cursorRef.current, agents.length);
		if (nextCursor !== cursorRef.current) {
			cursorRef.current = nextCursor;
			setCursor(nextCursor);
		}
	}, [agents.length, cursorRef]);

	useTerminalInput((events) => {
		const result = reduceAgentMenuBatch(
			cursorRef.current,
			events,
			agents.length,
		);
		if (result.cursor !== cursorRef.current) {
			cursorRef.current = result.cursor;
			setCursor(result.cursor);
		}

		if (result.effect.type === "dismiss") {
			onDismiss();
			return;
		}

		if (result.effect.type === "select") {
			const agent = agents[result.effect.cursor];
			if (agent) {
				onSelect(agent);
			}
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
