import type { Key } from "ink";
import {
	applyTextAreaKeypress,
	type TextAreaChange,
} from "./text-area-keypress.ts";

export const LARGE_PASTE_LINE_THRESHOLD = 3;

export interface CollapsedPastePlaceholder {
	start: number;
	end: number;
	summary: string;
	pastedContent: string;
}

export interface CollapsedPasteDraft {
	value: string;
	cursor: number;
	preferredColumn: number | null;
	placeholders: CollapsedPastePlaceholder[];
}

export interface CollapsedPasteResult {
	type: "clear" | "ignore" | "submit" | "update";
	draft?: CollapsedPasteDraft;
	value?: string;
}

export interface LargePasteInsertion {
	insertEnd: number;
	insertStart: number;
	insertedText: string;
	lineCount: number;
}

export function countLines(value: string): number {
	if (!value) return 1;
	return value.split("\n").length;
}

export function formatCollapsedPasteSummary(
	lineCount: number,
	index: number,
): string {
	return `[pasted content #${index}: ${lineCount} lines]`;
}

export function createPasteAwareDraft(
	value = "",
	cursor = value.length,
): CollapsedPasteDraft {
	return {
		value,
		cursor,
		preferredColumn: null,
		placeholders: [],
	};
}

function createPlaceholder(
	pastedContent: string,
	start: number,
): CollapsedPastePlaceholder {
	const summary = formatCollapsedPasteSummary(countLines(pastedContent), 1);
	return {
		start,
		end: start + summary.length,
		summary,
		pastedContent,
	};
}

export function createCollapsedPasteDraft(
	pastedContent: string,
	options?: {
		prefix?: string;
		suffix?: string;
	},
): CollapsedPasteDraft {
	const prefix = options?.prefix ?? "";
	const suffix = options?.suffix ?? "";
	const placeholder = createPlaceholder(pastedContent, prefix.length);
	return {
		value: `${prefix}${placeholder.summary}${suffix}`,
		cursor: placeholder.end,
		preferredColumn: null,
		placeholders: [placeholder],
	};
}

export function getCollapsedPasteDisplayValue(
	draft: CollapsedPasteDraft,
): string {
	return draft.value;
}

export function getCollapsedPasteDisplayCursor(
	draft: CollapsedPasteDraft,
): number {
	return draft.cursor;
}

export function expandCollapsedPasteDraft(draft: CollapsedPasteDraft): string {
	if (draft.placeholders.length === 0) {
		return draft.value;
	}

	let expanded = "";
	let cursor = 0;
	for (const placeholder of draft.placeholders) {
		expanded +=
			draft.value.slice(cursor, placeholder.start) + placeholder.pastedContent;
		cursor = placeholder.end;
	}
	return expanded + draft.value.slice(cursor);
}

function renumberCollapsedPasteDraft(
	draft: CollapsedPasteDraft,
): CollapsedPasteDraft {
	if (draft.placeholders.length === 0) {
		return draft;
	}

	let nextValue = "";
	let nextCursor = draft.cursor;
	let sourceIndex = 0;
	const nextPlaceholders: CollapsedPastePlaceholder[] = [];

	for (const [index, placeholder] of draft.placeholders.entries()) {
		const beforePlaceholder = draft.value.slice(sourceIndex, placeholder.start);
		nextValue += beforePlaceholder;

		const summary = formatCollapsedPasteSummary(
			countLines(placeholder.pastedContent),
			index + 1,
		);
		const nextStart = nextValue.length;
		const oldLength = placeholder.end - placeholder.start;
		const lengthDelta = summary.length - oldLength;

		if (draft.cursor >= placeholder.start && draft.cursor <= placeholder.end) {
			nextCursor =
				nextStart + Math.min(draft.cursor - placeholder.start, summary.length);
		} else if (draft.cursor > placeholder.end) {
			nextCursor += lengthDelta;
		}

		nextValue += summary;
		nextPlaceholders.push({
			...placeholder,
			start: nextStart,
			end: nextStart + summary.length,
			summary,
		});
		sourceIndex = placeholder.end;
	}

	nextValue += draft.value.slice(sourceIndex);
	return {
		...draft,
		value: nextValue,
		cursor: nextCursor,
		placeholders: nextPlaceholders,
	};
}

interface ChangedRange {
	newEnd: number;
	newStart: number;
	oldEnd: number;
	oldStart: number;
}

function getChangedRange(
	previousValue: string,
	nextValue: string,
): ChangedRange | null {
	if (previousValue === nextValue) {
		return null;
	}

	let prefixLength = 0;
	while (
		prefixLength < previousValue.length &&
		prefixLength < nextValue.length &&
		previousValue[prefixLength] === nextValue[prefixLength]
	) {
		prefixLength += 1;
	}

	let previousSuffixStart = previousValue.length;
	let nextSuffixStart = nextValue.length;
	while (
		previousSuffixStart > prefixLength &&
		nextSuffixStart > prefixLength &&
		previousValue[previousSuffixStart - 1] === nextValue[nextSuffixStart - 1]
	) {
		previousSuffixStart -= 1;
		nextSuffixStart -= 1;
	}

	return {
		newEnd: nextSuffixStart,
		newStart: prefixLength,
		oldEnd: previousSuffixStart,
		oldStart: prefixLength,
	};
}

export function detectLargePasteInsertion(
	previousValue: string,
	nextValue: string,
	threshold = LARGE_PASTE_LINE_THRESHOLD,
): LargePasteInsertion | null {
	const changedRange = getChangedRange(previousValue, nextValue);
	if (changedRange === null) {
		return null;
	}
	if (changedRange.oldStart !== changedRange.oldEnd) {
		return null;
	}

	const insertedText = nextValue.slice(
		changedRange.newStart,
		changedRange.newEnd,
	);
	if (insertedText.length <= 1) {
		return null;
	}

	const lineCount = countLines(insertedText);
	if (lineCount <= threshold) {
		return null;
	}

	return {
		insertEnd: changedRange.newEnd,
		insertStart: changedRange.newStart,
		insertedText,
		lineCount,
	};
}

export function shouldCollapseLargePaste(
	previousValue: string,
	nextValue: string,
	threshold = LARGE_PASTE_LINE_THRESHOLD,
): number | null {
	return (
		detectLargePasteInsertion(previousValue, nextValue, threshold)?.lineCount ??
		null
	);
}

function applyVisibleChange(
	value: string,
	change: TextAreaChange,
	text: string,
): string {
	return value.slice(0, change.start) + text + value.slice(change.end);
}

function applyChangeToPlaceholders(
	placeholders: CollapsedPastePlaceholder[],
	change: TextAreaChange,
): CollapsedPastePlaceholder[] {
	if (placeholders.length === 0) {
		return placeholders;
	}

	const delta = change.text.length - (change.end - change.start);
	const nextPlaceholders: CollapsedPastePlaceholder[] = [];
	let changed = false;

	for (const placeholder of placeholders) {
		if (change.end <= placeholder.start) {
			nextPlaceholders.push({
				...placeholder,
				start: placeholder.start + delta,
				end: placeholder.end + delta,
			});
			if (delta !== 0) {
				changed = true;
			}
			continue;
		}

		if (change.start >= placeholder.end) {
			nextPlaceholders.push(placeholder);
			continue;
		}

		changed = true;
	}

	return changed ? nextPlaceholders : placeholders;
}

function insertPlaceholder(
	placeholders: CollapsedPastePlaceholder[],
	placeholder: CollapsedPastePlaceholder,
): CollapsedPastePlaceholder[] {
	const nextPlaceholders = [...placeholders];
	let index = 0;
	while (
		index < nextPlaceholders.length &&
		(nextPlaceholders[index]?.start ?? 0) <= placeholder.start
	) {
		index += 1;
	}
	nextPlaceholders.splice(index, 0, placeholder);
	return nextPlaceholders;
}

function samePlaceholders(
	left: CollapsedPastePlaceholder[],
	right: CollapsedPastePlaceholder[],
): boolean {
	if (left === right) {
		return true;
	}
	if (left.length !== right.length) {
		return false;
	}

	for (let index = 0; index < left.length; index++) {
		const leftPlaceholder = left[index];
		const rightPlaceholder = right[index];
		if (
			leftPlaceholder?.start !== rightPlaceholder?.start ||
			leftPlaceholder?.end !== rightPlaceholder?.end ||
			leftPlaceholder?.summary !== rightPlaceholder?.summary ||
			leftPlaceholder?.pastedContent !== rightPlaceholder?.pastedContent
		) {
			return false;
		}
	}
	return true;
}

function shouldCollapseChange(change: TextAreaChange): boolean {
	return (
		change.start === change.end &&
		change.text.length > 1 &&
		countLines(change.text) > LARGE_PASTE_LINE_THRESHOLD
	);
}

export function applyCollapsedPasteKeypress(
	draft: CollapsedPasteDraft,
	input: string,
	key: Key,
	sequence?: string,
): CollapsedPasteResult {
	if (key.escape && draft.placeholders.length > 0) {
		return { type: "clear" };
	}
	if (key.tab) {
		return { type: "ignore" };
	}

	const result = applyTextAreaKeypress(
		{
			value: draft.value,
			cursor: draft.cursor,
			preferredColumn: draft.preferredColumn,
		},
		input,
		key,
		sequence,
	);
	if (!result.handled) {
		return { type: "ignore" };
	}
	if (result.submit) {
		return { type: "submit", value: expandCollapsedPasteDraft(draft) };
	}

	let nextValue = result.value;
	let nextCursor = result.cursor;
	let nextPreferredColumn = result.preferredColumn;
	let nextPlaceholders = draft.placeholders;

	if (result.change) {
		nextPlaceholders = applyChangeToPlaceholders(
			draft.placeholders,
			result.change,
		);
		if (shouldCollapseChange(result.change)) {
			const placeholder = createPlaceholder(
				result.change.text,
				result.change.start,
			);
			nextValue = applyVisibleChange(
				draft.value,
				result.change,
				placeholder.summary,
			);
			nextCursor = placeholder.end;
			nextPreferredColumn = null;
			nextPlaceholders = insertPlaceholder(nextPlaceholders, placeholder);
		}
	}

	const nextDraft: CollapsedPasteDraft = {
		value: nextValue,
		cursor: nextCursor,
		preferredColumn: nextPreferredColumn,
		placeholders: nextPlaceholders,
	};
	const normalizedDraft = renumberCollapsedPasteDraft(nextDraft);

	if (
		normalizedDraft.value === draft.value &&
		normalizedDraft.cursor === draft.cursor &&
		normalizedDraft.preferredColumn === draft.preferredColumn &&
		samePlaceholders(normalizedDraft.placeholders, draft.placeholders)
	) {
		return { type: "ignore" };
	}

	return {
		type: "update",
		draft: normalizedDraft,
	};
}
