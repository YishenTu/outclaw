import { describe, expect, test } from "bun:test";
import {
	GitCommitContent,
	GitCommitViewer,
} from "../../../src/frontend/browser/components/git-commit-viewer/git-commit-viewer.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("GitCommitContent", () => {
	test("renders commit metadata, message body, and parsed patch", () => {
		const html = renderToStaticMarkup(
			<GitCommitContent
				commit={{
					sha: "bbbbbbb1234567",
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-17T12:34:56.000Z",
					},
					message: "Second commit\n\nExplain the new changes.",
					parents: [{ sha: "aaaaaaa7654321" }],
					diff: `diff --git a/README.md b/README.md
index cefe630..1111111 100644
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
-first
+second
+third
`,
				}}
			/>,
		);

		expect(html).toContain("Commit / bbbbbbb");
		expect(html).toContain("Second commit");
		expect(html).toContain("Explain the new changes.");
		expect(html).toContain("Test User");
		expect(html).toContain("test@example.com");
		expect(html).toContain("Parents");
		expect(html).toContain("aaaaaaa");
		expect(html).toContain("README.md");
		expect(html).toContain("second");
	});
});

describe("GitCommitViewer", () => {
	test("uses the shared hidden-scrollbar preview container without a manual refresh button", () => {
		const html = renderToStaticMarkup(
			<GitCommitViewer sha="bbbbbbb1234567" title="Second commit" />,
		);

		expect(html).toContain("Commit / bbbbbbb");
		expect(html).toContain(
			"scrollbar-none min-h-0 flex-1 overflow-y-auto px-6 py-6",
		);
		expect(html).not.toContain("Refresh");
	});
});
