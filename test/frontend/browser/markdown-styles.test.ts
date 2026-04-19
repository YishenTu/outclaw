import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const browserCss = readFileSync(
	join(import.meta.dir, "../../../src/frontend/browser/index.css"),
	"utf8",
);

describe("browser markdown styles", () => {
	test("imports katex styles and lets display equations scroll horizontally", () => {
		expect(browserCss).toContain('@import "katex/dist/katex.min.css";');
		expect(browserCss).toMatch(
			/\.prose \.katex-display\s*{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/s,
		);
	});
});
