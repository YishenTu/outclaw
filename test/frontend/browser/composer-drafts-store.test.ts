import { beforeEach, describe, expect, test } from "bun:test";
import type { ComposerImageAttachment } from "../../../src/frontend/browser/attachments/composer-images.ts";
import { useComposerDraftsStore } from "../../../src/frontend/browser/stores/composer-drafts.ts";

function resetStore<TState>(store: {
	getInitialState(): TState;
	setState(state: TState, replace: true): void;
}) {
	store.setState(store.getInitialState(), true);
}

function createAttachment(id: string): ComposerImageAttachment {
	return {
		id,
		file: new File(["abc"], `${id}.png`, { type: "image/png" }),
		image: {
			kind: "inline",
			base64: "YWJj",
			mediaType: "image/png",
		},
	};
}

describe("browser composer drafts store", () => {
	beforeEach(() => {
		resetStore(useComposerDraftsStore);
	});

	test("keeps tab-scoped drafts independent until their tab is cleared", () => {
		const chatImage = createAttachment("chat-image");
		useComposerDraftsStore.getState().setDraft("tab:chat", {
			text: "summarize this before I switch tabs",
			images: [chatImage],
		});
		useComposerDraftsStore.getState().setDraft("tab:file:AGENTS.md", {
			text: "file-local draft",
			images: [],
		});

		useComposerDraftsStore.getState().clearDraft("tab:file:AGENTS.md");

		expect(useComposerDraftsStore.getState().getDraft("tab:chat")).toEqual({
			text: "summarize this before I switch tabs",
			images: [chatImage],
		});
		expect(
			useComposerDraftsStore.getState().getDraft("tab:file:AGENTS.md"),
		).toEqual({
			text: "",
			images: [],
		});
	});
});
