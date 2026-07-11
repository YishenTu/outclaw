import { beforeEach, describe, expect, test } from "bun:test";
import {
	CODING_STORAGE_KEY,
	useCodingStore,
} from "../../../src/frontend/browser/coding/coding-store.ts";
import { MobileLayoutPanels } from "../../../src/frontend/browser/layouts/mobile-layout-view.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";
import { useMobileNavStore } from "../../../src/frontend/browser/stores/mobile-nav.ts";

function resetStore<TState>(store: {
	getInitialState(): TState;
	setState(state: TState, replace: true): void;
}) {
	store.setState(store.getInitialState(), true);
}

describe("browser mobile layout", () => {
	beforeEach(() => {
		resetStore(useCodingStore);
		resetStore(useMobileNavStore);
		if (typeof globalThis.localStorage !== "undefined") {
			globalThis.localStorage.removeItem(CODING_STORAGE_KEY);
		}
	});

	test("renders code-mode panels on mobile when code mode is active", () => {
		const html = renderToStaticMarkup(
			<MobileLayoutPanels
				isCodeMode
				mobilePanel="chat"
				onShowCenter={() => {}}
				onShowLeftPanel={() => {}}
				onShowRightPanel={() => {}}
			/>,
		);

		expect(html).toContain("Loading coding sidebar…");
		expect(html).toContain("Loading coding workspace…");
		expect(html).toContain("Loading coding inspector…");
	});
});
