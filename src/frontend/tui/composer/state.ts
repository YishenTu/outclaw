import {
	detectMentionToken,
	replaceMentionToken,
} from "../../../common/mention.ts";
import type {
	SkillInfo,
	WorkspaceFileEntry,
} from "../../../common/protocol.ts";
import { matchCommands } from "../command-menu/state.ts";
import {
	clampMentionMenuIndex,
	matchedMentions,
} from "../mention-menu/state.ts";
import { clampSelectionIndex, moveWrappedSelection } from "../selection.ts";
import type { TextAreaInputEvent } from "./input.ts";
import {
	applyCollapsedPasteKeypress,
	type CollapsedPasteDraft,
	createPasteAwareDraft,
} from "./paste-draft.ts";

export interface ComposerState {
	draft: CollapsedPasteDraft;
	cmdMenuIndex: number;
	cmdMenuDismissed: boolean;
	mentionMenuIndex: number;
	mentionMenuDismissed: boolean;
}

export interface ComposerBatchOptions {
	inputActive: boolean;
	skills: SkillInfo[];
	workspaceFiles: WorkspaceFileEntry[];
	onMentionTokenActive?: () => void;
}

export type ComposerBatchEffect =
	| { type: "none" }
	| { type: "submit"; value: string };

export interface ComposerBatchResult {
	effect: ComposerBatchEffect;
	state: ComposerState;
}

export function createComposerState(): ComposerState {
	return {
		draft: createPasteAwareDraft(),
		cmdMenuIndex: 0,
		cmdMenuDismissed: false,
		mentionMenuIndex: 0,
		mentionMenuDismissed: false,
	};
}

export function withComposerDraft(
	state: ComposerState,
	draft: CollapsedPasteDraft,
): ComposerState {
	return {
		...state,
		draft,
		cmdMenuIndex: 0,
		cmdMenuDismissed: false,
		mentionMenuIndex: 0,
		mentionMenuDismissed: false,
	};
}

export function clampCommandMenuIndex(index: number, count: number): number {
	return clampSelectionIndex(index, count);
}

export interface ResolvedMentionMenu {
	matches: WorkspaceFileEntry[];
	visible: boolean;
}

export function resolveMentionMenu(
	state: ComposerState,
	options: ComposerBatchOptions,
): ResolvedMentionMenu {
	const token = detectMentionToken(state.draft.value, state.draft.cursor);
	if (!token) {
		return { matches: [], visible: false };
	}
	const matches = matchedMentions(options.workspaceFiles, token);
	return {
		matches,
		visible:
			options.inputActive && matches.length > 0 && !state.mentionMenuDismissed,
	};
}

function normalizeComposerState(
	state: ComposerState,
	options: ComposerBatchOptions,
): ComposerState {
	let next = state;
	const matchedCommands = matchCommands(state.draft.value, options.skills);
	const cmdIndex = clampCommandMenuIndex(
		state.cmdMenuIndex,
		matchedCommands.length,
	);
	if (cmdIndex !== state.cmdMenuIndex) {
		next = { ...next, cmdMenuIndex: cmdIndex };
	}

	const { matches } = resolveMentionMenu(next, options);
	const mentionIndex = clampMentionMenuIndex(
		next.mentionMenuIndex,
		matches.length,
	);
	if (mentionIndex !== next.mentionMenuIndex) {
		next = { ...next, mentionMenuIndex: mentionIndex };
	}
	return next;
}

export function reduceComposerBatch(
	state: ComposerState,
	events: TextAreaInputEvent[],
	options: ComposerBatchOptions,
): ComposerBatchResult {
	let nextState = normalizeComposerState(state, options);

	for (const { input, key, sequence } of events) {
		const mentionToken = detectMentionToken(
			nextState.draft.value,
			nextState.draft.cursor,
		);
		if (mentionToken) {
			options.onMentionTokenActive?.();
		}
		const mentionMatches = mentionToken
			? matchedMentions(options.workspaceFiles, mentionToken)
			: [];
		const mentionMenuVisible =
			options.inputActive &&
			mentionToken !== null &&
			mentionMatches.length > 0 &&
			!nextState.mentionMenuDismissed;

		if (mentionMenuVisible && mentionToken) {
			if (key.upArrow || (key.ctrl && input === "p")) {
				nextState = {
					...nextState,
					mentionMenuIndex: moveWrappedSelection(
						nextState.mentionMenuIndex,
						mentionMatches.length,
						-1,
					),
				};
				continue;
			}

			if (key.downArrow || (key.ctrl && input === "n")) {
				nextState = {
					...nextState,
					mentionMenuIndex: moveWrappedSelection(
						nextState.mentionMenuIndex,
						mentionMatches.length,
						1,
					),
				};
				continue;
			}

			if (key.tab || key.return) {
				const selected = mentionMatches[nextState.mentionMenuIndex];
				if (!selected) {
					return { effect: { type: "none" }, state: nextState };
				}
				const replaced = replaceMentionToken(
					nextState.draft.value,
					mentionToken,
					selected.path,
				);
				return {
					effect: { type: "none" },
					state: withComposerDraft(
						nextState,
						createPasteAwareDraft(replaced.value, replaced.cursor),
					),
				};
			}

			if (key.escape) {
				return {
					effect: { type: "none" },
					state: {
						...nextState,
						mentionMenuDismissed: true,
					},
				};
			}
		}

		const matchedCommands = matchCommands(
			nextState.draft.value,
			options.skills,
		);
		const cmdMenuVisible =
			options.inputActive &&
			!mentionMenuVisible &&
			matchedCommands.length > 0 &&
			!nextState.cmdMenuDismissed;

		if (cmdMenuVisible) {
			if (key.upArrow || (key.ctrl && input === "p")) {
				nextState = {
					...nextState,
					cmdMenuIndex: moveWrappedSelection(
						nextState.cmdMenuIndex,
						matchedCommands.length,
						-1,
					),
				};
				continue;
			}

			if (key.downArrow || (key.ctrl && input === "n")) {
				nextState = {
					...nextState,
					cmdMenuIndex: moveWrappedSelection(
						nextState.cmdMenuIndex,
						matchedCommands.length,
						1,
					),
				};
				continue;
			}

			if (key.tab || key.return) {
				const selected = matchedCommands[nextState.cmdMenuIndex];
				if (!selected) {
					return { effect: { type: "none" }, state: nextState };
				}

				const filled = `${selected.command} `;
				return {
					effect: { type: "none" },
					state: withComposerDraft(
						nextState,
						createPasteAwareDraft(filled, filled.length),
					),
				};
			}

			if (key.escape) {
				return {
					effect: { type: "none" },
					state: {
						...nextState,
						cmdMenuDismissed: true,
					},
				};
			}
		}

		const action = applyCollapsedPasteKeypress(
			nextState.draft,
			input,
			key,
			sequence,
		);
		if (action.type === "ignore") {
			continue;
		}
		if (action.type === "clear") {
			return {
				effect: { type: "none" },
				state: createComposerState(),
			};
		}
		if (action.type === "submit") {
			return {
				effect: {
					type: "submit",
					value: action.value ?? nextState.draft.value,
				},
				state: nextState,
			};
		}
		if (action.type === "update" && action.draft) {
			nextState = withComposerDraft(nextState, action.draft);
		}
	}

	return {
		effect: { type: "none" },
		state: nextState,
	};
}
