import {
	type MentionToken,
	matchMentionEntries,
} from "../../../common/mention.ts";
import type { WorkspaceFileEntry } from "../../../common/protocol.ts";
import { clampSelectionIndex } from "../selection.ts";

export const MAX_VISIBLE_MENTIONS = 6;
export const MAX_MENTION_RESULTS = 50;

export function matchedMentions(
	entries: readonly WorkspaceFileEntry[],
	token: MentionToken,
): WorkspaceFileEntry[] {
	return matchMentionEntries(entries, token.query, {
		limit: MAX_MENTION_RESULTS,
	});
}

export function clampMentionMenuIndex(index: number, count: number): number {
	return clampSelectionIndex(index, count);
}

export function visibleMentionWindow(
	items: WorkspaceFileEntry[],
	selectedIndex: number,
): { items: WorkspaceFileEntry[]; startIndex: number } {
	if (items.length <= MAX_VISIBLE_MENTIONS) {
		return { items, startIndex: 0 };
	}
	let start = selectedIndex - Math.floor(MAX_VISIBLE_MENTIONS / 2);
	start = Math.max(0, Math.min(start, items.length - MAX_VISIBLE_MENTIONS));
	return {
		items: items.slice(start, start + MAX_VISIBLE_MENTIONS),
		startIndex: start,
	};
}
