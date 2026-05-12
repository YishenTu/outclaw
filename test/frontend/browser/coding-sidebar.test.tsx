import { describe, expect, test } from "bun:test";
import { CodingSidebar } from "../../../src/frontend/browser/coding/coding-sidebar.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

const NOOP = () => {};

describe("CodingSidebar", () => {
	test("renders archive beside add repo in the fixed bottom action row", () => {
		const html = renderToStaticMarkup(
			<CodingSidebar
				repositories={[]}
				archivedRepositories={[]}
				sessionsByRepository={{}}
				archivedSessions={[]}
				focusedRepositoryId={undefined}
				focusedSession={undefined}
				onSelectRepository={NOOP}
				onSelectSession={NOOP}
				onCreateRepository={NOOP}
			/>,
		);

		const addRepoIndex = html.indexOf(">Add repo<");
		const archiveIndex = html.indexOf(">Archive<");

		expect(html).toContain("grid shrink-0 grid-cols-2 border-t");
		expect(addRepoIndex).toBeGreaterThan(-1);
		expect(archiveIndex).toBeGreaterThan(addRepoIndex);
		expect(html).not.toContain("Archived sessions");
	});
});
