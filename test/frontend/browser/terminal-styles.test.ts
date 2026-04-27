import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const browserCss = readFileSync(
	join(import.meta.dir, "../../../src/frontend/browser/index.css"),
	"utf8",
);

const terminalViewSource = readFileSync(
	join(
		import.meta.dir,
		"../../../src/frontend/browser/components/right-panel/terminal-view.tsx",
	),
	"utf8",
);

describe("browser terminal styles", () => {
	test("scopes xterm viewport scrollbar hiding to the browser terminal shell", () => {
		expect(terminalViewSource).toContain("browser-terminal-shell");
		expect(browserCss).toMatch(
			/\.browser-terminal-shell \.xterm \.xterm-viewport\s*{[^}]*overflow-y:\s*scroll !important;[^}]*scrollbar-width:\s*none;[^}]*-ms-overflow-style:\s*none;/s,
		);
		expect(browserCss).toMatch(
			/\.browser-terminal-shell \.xterm \.xterm-viewport::-webkit-scrollbar\s*{[^}]*display:\s*none;[^}]*width:\s*0;[^}]*height:\s*0;/s,
		);
	});
});
