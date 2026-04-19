import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const browserCss = readFileSync(
	join(import.meta.dir, "../../../src/frontend/browser/index.css"),
	"utf8",
);

describe("git graph styles", () => {
	test("uses the same sans font stack and text-sm sizing as changed files", () => {
		expect(browserCss).toMatch(/--font-ui-sans:\s*"IBM Plex Sans"/);
		expect(browserCss).toMatch(
			/body\s*{[^}]*font-family:\s*var\(--font-ui-sans\);/s,
		);
		expect(browserCss).toMatch(
			/\.git-graph-shell \[class\*="index-module_container__wEBx3"\]\s*{[^}]*font-family:\s*var\(--font-ui-sans\);[^}]*font-size:\s*0\.875rem;[^}]*line-height:\s*1\.25rem;/s,
		);
		expect(browserCss).toMatch(
			/\.git-graph-shell \[class\*="index-module_msg__"\]\s*{[^}]*font-size:\s*0\.875rem;[^}]*line-height:\s*1\.25rem;/s,
		);
		expect(browserCss).toMatch(
			/\.git-graph-shell \[class\*="index-module_msg__"\]\s*{[^}]*text-overflow:\s*clip;/s,
		);
	});

	test("keeps git graph rows vertically compact", () => {
		expect(browserCss).toMatch(
			/\.git-graph-shell \[class\*="index-module_details__"\]\s*{[^}]*height:\s*1\.25rem;[^}]*transform:\s*translateY\(1rem\);/s,
		);
		expect(browserCss).toMatch(
			/\.git-graph-shell \[class\*="index-module_block__"\]\s*{[^}]*height:\s*1\.25rem;[^}]*transform:\s*translateY\(1rem\);/s,
		);
		expect(browserCss).toMatch(
			/\.git-graph-shell \[class\*="index-module_msg__"\]\s*{[^}]*height:\s*1\.25rem;/s,
		);
	});
});
