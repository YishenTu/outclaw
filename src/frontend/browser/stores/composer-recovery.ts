import { create } from "zustand";
import type { ComposerDraft } from "../chat/composer-draft.ts";

interface RecoverableDraft {
	draft: ComposerDraft;
	restorable: boolean;
}

export interface ComposerRecoveryState {
	draftsBySessionKey: Record<string, RecoverableDraft>;
	clearDraft: (sessionKey: string) => void;
	consumeRestorableDraft: (sessionKey: string) => ComposerDraft | undefined;
	requestRestore: (sessionKey: string) => void;
	saveDraft: (sessionKey: string, draft: ComposerDraft) => void;
}

export const useComposerRecoveryStore = create<ComposerRecoveryState>(
	(set, get) => ({
		draftsBySessionKey: {},
		clearDraft: (sessionKey) =>
			set((state) => {
				if (state.draftsBySessionKey[sessionKey] === undefined) {
					return state;
				}
				const { [sessionKey]: _removed, ...draftsBySessionKey } =
					state.draftsBySessionKey;
				return { draftsBySessionKey };
			}),
		consumeRestorableDraft: (sessionKey) => {
			const entry = get().draftsBySessionKey[sessionKey];
			if (entry === undefined || !entry.restorable) {
				return undefined;
			}
			get().clearDraft(sessionKey);
			return entry.draft;
		},
		requestRestore: (sessionKey) =>
			set((state) => {
				const entry = state.draftsBySessionKey[sessionKey];
				if (entry === undefined || entry.restorable) {
					return state;
				}
				return {
					draftsBySessionKey: {
						...state.draftsBySessionKey,
						[sessionKey]: {
							...entry,
							restorable: true,
						},
					},
				};
			}),
		saveDraft: (sessionKey, draft) =>
			set((state) => ({
				draftsBySessionKey: {
					...state.draftsBySessionKey,
					[sessionKey]: {
						draft,
						restorable: false,
					},
				},
			})),
	}),
);
