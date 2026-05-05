import { create } from "zustand";
import {
	type ComposerDraft,
	createEmptyComposerDraft,
} from "../chat/composer-draft.ts";

export interface ComposerDraftsState {
	drafts: Record<string, ComposerDraft>;

	getDraft: (draftKey: string) => ComposerDraft;
	setDraft: (draftKey: string, draft: ComposerDraft) => void;
	clearDraft: (draftKey: string) => void;
}

export const useComposerDraftsStore = create<ComposerDraftsState>(
	(set, get) => ({
		drafts: {},
		getDraft: (draftKey) =>
			get().drafts[draftKey] ?? createEmptyComposerDraft(),
		setDraft: (draftKey, draft) =>
			set((state) => ({
				drafts: {
					...state.drafts,
					[draftKey]: draft,
				},
			})),
		clearDraft: (draftKey) =>
			set((state) => {
				const { [draftKey]: _discardedDraft, ...drafts } = state.drafts;
				return { drafts };
			}),
	}),
);
