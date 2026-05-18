import { describe, expect, test } from "bun:test";
import { useComposerRecoveryStore } from "../../../src/frontend/browser/stores/composer-recovery.ts";

function resetStore<TState>(store: {
	getInitialState(): TState;
	setState(state: TState, replace: true): void;
}) {
	store.setState(store.getInitialState(), true);
}

describe("browser composer draft recovery", () => {
	test("stores submitted drafts and consumes them only after restore is requested", () => {
		resetStore(useComposerRecoveryStore);

		const draft = {
			text: "slow task",
			images: [],
		};

		useComposerRecoveryStore
			.getState()
			.saveDraft("agent-a:mock:__pending__", draft);

		expect(
			useComposerRecoveryStore
				.getState()
				.consumeRestorableDraft("agent-a:mock:__pending__"),
		).toBeUndefined();

		useComposerRecoveryStore
			.getState()
			.requestRestore("agent-a:mock:__pending__");

		expect(
			useComposerRecoveryStore
				.getState()
				.consumeRestorableDraft("agent-a:mock:__pending__"),
		).toEqual(draft);
		expect(
			useComposerRecoveryStore
				.getState()
				.consumeRestorableDraft("agent-a:mock:__pending__"),
		).toBeUndefined();
	});
});
