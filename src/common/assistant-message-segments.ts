import type { AssistantMessageSegment, FacadeEvent } from "./protocol.ts";
import {
	appendThinkingBlockDelta,
	createThinkingBlockState,
	effectiveThinkingBlocks,
	snapshotThinkingBlockState,
} from "./thinking-blocks.ts";

export interface AssistantMessageAggregate {
	text: string;
	thinking: string;
	thinkingBlocks: string[];
	thinkingBlockId?: string;
}

export function appendAssistantMessageSegment(
	segments: readonly AssistantMessageSegment[],
	segment: AssistantMessageSegment,
): AssistantMessageSegment[] {
	if (segment.text === "") {
		return cloneAssistantMessageSegments(segments);
	}

	const last = segments.at(-1);
	if (last && canMergeAssistantMessageSegments(last, segment)) {
		return [
			...segments.slice(0, -1),
			mergeAssistantMessageSegments(last, segment),
		];
	}

	return [...cloneAssistantMessageSegments(segments), cloneSegment(segment)];
}

export function canMergeAssistantMessageSegments(
	current: AssistantMessageSegment,
	next: AssistantMessageSegment,
): boolean {
	if (current.type !== next.type) {
		return false;
	}
	if (current.type === "text") {
		return true;
	}
	return next.type === "thinking" && current.blockId === next.blockId;
}

export function startsNewAssistantMessageSegment(
	current: AssistantMessageSegment,
	next: AssistantMessageSegment,
): boolean {
	return (
		current.text !== "" &&
		next.text !== "" &&
		!canMergeAssistantMessageSegments(current, next)
	);
}

export function assistantTextSegment(text: string): AssistantMessageSegment {
	return { type: "text", text };
}

export function assistantThinkingSegment(
	text: string,
	blockId?: string,
): AssistantMessageSegment {
	return {
		type: "thinking",
		text,
		...(blockId !== undefined ? { blockId } : {}),
	};
}

export function appendAssistantStreamEvent(
	segments: readonly AssistantMessageSegment[],
	event: FacadeEvent,
): AssistantMessageSegment[] {
	if (event.type === "text") {
		return appendAssistantMessageSegment(
			segments,
			assistantTextSegment(event.text),
		);
	}
	if (event.type === "thinking") {
		return appendAssistantMessageSegment(
			segments,
			assistantThinkingSegment(event.text, event.blockId),
		);
	}
	return cloneAssistantMessageSegments(segments);
}

export function isAssistantActionBoundaryEvent(event: {
	type: string;
}): boolean {
	switch (event.type) {
		case "command_execution_started":
		case "command_execution_output":
		case "command_execution_completed":
		case "file_change_applied":
		case "subagent_tool_started":
		case "subagent_tool_completed":
		case "web_search_started":
		case "web_search_completed":
		case "tool_call_started":
		case "tool_call_completed":
			return true;
		default:
			return false;
	}
}

export function aggregateAssistantMessageSegments(
	segments: readonly AssistantMessageSegment[],
): AssistantMessageAggregate {
	let text = "";
	let thinking = createThinkingBlockState();
	for (const segment of segments) {
		if (segment.type === "text") {
			text += segment.text;
			continue;
		}
		thinking = appendThinkingBlockDelta(thinking, {
			text: segment.text,
			blockId: segment.blockId,
		});
	}
	const thinkingSnapshot = snapshotThinkingBlockState(thinking);
	return {
		text,
		thinking: thinkingSnapshot.text,
		thinkingBlocks: thinkingSnapshot.blocks,
		...(thinkingSnapshot.currentBlockId !== undefined
			? { thinkingBlockId: thinkingSnapshot.currentBlockId }
			: {}),
	};
}

export function assistantMessageSegmentsFromAggregates(params: {
	text: string;
	thinking: string;
	thinkingBlocks?: readonly string[];
	thinkingBlockId?: string;
}): AssistantMessageSegment[] {
	const segments: AssistantMessageSegment[] = [];
	const thinkingBlocks = effectiveThinkingBlocks({
		text: params.thinking,
		blocks: params.thinkingBlocks,
	});
	for (const [index, block] of thinkingBlocks.entries()) {
		segments.push({
			type: "thinking",
			text: block,
			...(index === thinkingBlocks.length - 1 &&
			params.thinkingBlockId !== undefined
				? { blockId: params.thinkingBlockId }
				: {}),
		});
	}
	if (params.text !== "") {
		segments.push({ type: "text", text: params.text });
	}
	return segments;
}

export function cloneAssistantMessageSegments(
	segments: readonly AssistantMessageSegment[] | undefined,
): AssistantMessageSegment[] {
	return (segments ?? []).map(cloneSegment);
}

export function hasAssistantMessageSegments(
	segments: readonly AssistantMessageSegment[] | undefined,
): boolean {
	return (segments ?? []).some((segment) => segment.text !== "");
}

export function assistantMessageSegmentsNeedOrderedDisplay(
	segments: readonly AssistantMessageSegment[] | undefined,
): boolean {
	let sawText = false;
	for (const segment of segments ?? []) {
		if (segment.text === "") {
			continue;
		}
		if (segment.type === "text") {
			sawText = true;
			continue;
		}
		if (sawText) {
			return true;
		}
	}
	return false;
}

function cloneSegment(
	segment: AssistantMessageSegment,
): AssistantMessageSegment {
	if (segment.type === "text") {
		return { type: "text", text: segment.text };
	}
	return {
		type: "thinking",
		text: segment.text,
		...(segment.blockId !== undefined ? { blockId: segment.blockId } : {}),
	};
}

function mergeAssistantMessageSegments(
	current: AssistantMessageSegment,
	next: AssistantMessageSegment,
): AssistantMessageSegment {
	if (current.type === "text" && next.type === "text") {
		return { type: "text", text: `${current.text}${next.text}` };
	}
	if (current.type !== "thinking" || next.type !== "thinking") {
		return cloneSegment(next);
	}
	return {
		type: "thinking",
		text: `${current.text}${next.text}`,
		...(next.blockId !== undefined ? { blockId: next.blockId } : {}),
	};
}
