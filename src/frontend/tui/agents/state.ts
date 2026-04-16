import type { TextAreaInputEvent } from "../composer/input.ts";
import { clampSelectionIndex, moveWrappedSelection } from "../selection.ts";

export type AgentMenuEffect =
	| { type: "none" }
	| { type: "dismiss" }
	| { type: "select"; cursor: number };

export interface AgentMenuBatchResult {
	cursor: number;
	effect: AgentMenuEffect;
}

export function clampAgentMenuCursor(cursor: number, count: number): number {
	return clampSelectionIndex(cursor, count);
}

export function reduceAgentMenuBatch(
	cursor: number,
	events: TextAreaInputEvent[],
	agentCount: number,
): AgentMenuBatchResult {
	let nextCursor = clampAgentMenuCursor(cursor, agentCount);

	for (const { key } of events) {
		if (agentCount === 0) {
			if (key.escape) {
				return { cursor: nextCursor, effect: { type: "dismiss" } };
			}

			return { cursor: nextCursor, effect: { type: "none" } };
		}

		if (key.escape) {
			return { cursor: nextCursor, effect: { type: "dismiss" } };
		}

		if (key.return) {
			return {
				cursor: nextCursor,
				effect: { type: "select", cursor: nextCursor },
			};
		}

		if (key.upArrow) {
			nextCursor = moveWrappedSelection(nextCursor, agentCount, -1);
		}

		if (key.downArrow) {
			nextCursor = moveWrappedSelection(nextCursor, agentCount, 1);
		}
	}

	return { cursor: nextCursor, effect: { type: "none" } };
}
