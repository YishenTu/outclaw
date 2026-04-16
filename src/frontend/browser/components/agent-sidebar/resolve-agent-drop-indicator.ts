import type { AgentReorderPosition } from "../../stores/agents.ts";

export interface AgentRowBounds {
	agentId: string;
	top: number;
	height: number;
}

export interface AgentDropIndicator {
	agentId: string;
	position: AgentReorderPosition;
}

export function resolveAgentDropIndicator(
	rows: AgentRowBounds[],
	draggingAgentId: string,
	pointerY: number,
): AgentDropIndicator | null {
	const orderedRows = rows
		.filter((row) => row.agentId !== draggingAgentId)
		.sort((left, right) => left.top - right.top);

	if (orderedRows.length === 0) {
		return null;
	}

	for (const row of orderedRows) {
		const midpoint = row.top + row.height / 2;
		if (pointerY < midpoint) {
			return {
				agentId: row.agentId,
				position: "before",
			};
		}
	}

	const lastRow = orderedRows.at(-1);
	if (!lastRow) {
		return null;
	}

	return {
		agentId: lastRow.agentId,
		position: "after",
	};
}
