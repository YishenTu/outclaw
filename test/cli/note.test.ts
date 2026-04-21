import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendNote } from "../../src/cli/note.ts";

function createMemoryRoot(): string {
	return mkdtempSync(join(tmpdir(), "outclaw-note-"));
}

function dailyPath(memoryRoot: string, date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return join(memoryRoot, "daily-memories", `${year}-${month}-${day}.md`);
}

describe("appendNote", () => {
	let tempRoot: string | undefined;

	afterEach(() => {
		if (tempRoot && existsSync(tempRoot)) {
			rmSync(tempRoot, { force: true, recursive: true });
		}
		tempRoot = undefined;
	});

	test("creates daily file with title, session stanza, and observation line", () => {
		tempRoot = createMemoryRoot();
		const now = new Date(2026, 3, 20, 14, 32);

		appendNote({
			content: "moved to runtime-owned write primitive",
			salience: "decision",
			hint: "outclaw",
			sessionId: "abc123",
			memoryRoot: tempRoot,
			now,
		});

		const content = readFileSync(dailyPath(tempRoot, now), "utf-8");
		expect(content).toContain("# 2026-04-20");
		expect(content).toContain("## Session abc123 | 14:32");
		expect(content).toContain(
			"- 14:32 [decision] moved to runtime-owned write primitive [[outclaw]]",
		);
	});

	test("reuses existing session stanza when session id matches last header", () => {
		tempRoot = createMemoryRoot();
		const first = new Date(2026, 3, 20, 14, 32);
		const second = new Date(2026, 3, 20, 14, 45);

		appendNote({
			content: "first",
			sessionId: "abc123",
			memoryRoot: tempRoot,
			now: first,
		});
		appendNote({
			content: "second",
			sessionId: "abc123",
			memoryRoot: tempRoot,
			now: second,
		});

		const content = readFileSync(dailyPath(tempRoot, first), "utf-8");
		const stanzaCount = content.match(/^## Session /gm)?.length ?? 0;
		expect(stanzaCount).toBe(1);
		expect(content).toContain("- 14:32 [routine] first");
		expect(content).toContain("- 14:45 [routine] second");
	});

	test("adds a fresh stanza when session id differs from last header", () => {
		tempRoot = createMemoryRoot();
		const first = new Date(2026, 3, 20, 14, 32);
		const second = new Date(2026, 3, 20, 18, 50);

		appendNote({
			content: "entry from A",
			sessionId: "abc123",
			memoryRoot: tempRoot,
			now: first,
		});
		appendNote({
			content: "entry from B",
			sessionId: "def456",
			memoryRoot: tempRoot,
			now: second,
		});

		const content = readFileSync(dailyPath(tempRoot, first), "utf-8");
		expect(content).toContain("## Session abc123 | 14:32");
		expect(content).toContain("## Session def456 | 18:50");
		const stanzaCount = content.match(/^## Session /gm)?.length ?? 0;
		expect(stanzaCount).toBe(2);
	});

	test("adds a fresh stanza when session returns after another session wrote", () => {
		tempRoot = createMemoryRoot();
		const a1 = new Date(2026, 3, 20, 14, 32);
		const b = new Date(2026, 3, 20, 18, 50);
		const a2 = new Date(2026, 3, 20, 19, 5);

		appendNote({
			content: "a1",
			sessionId: "abc",
			memoryRoot: tempRoot,
			now: a1,
		});
		appendNote({
			content: "b",
			sessionId: "def",
			memoryRoot: tempRoot,
			now: b,
		});
		appendNote({
			content: "a2",
			sessionId: "abc",
			memoryRoot: tempRoot,
			now: a2,
		});

		const content = readFileSync(dailyPath(tempRoot, a1), "utf-8");
		const stanzaHeaders =
			content.match(/^## Session [a-z]+ \| \d\d:\d\d/gm) ?? [];
		expect(stanzaHeaders).toEqual([
			"## Session abc | 14:32",
			"## Session def | 18:50",
			"## Session abc | 19:05",
		]);
	});

	test("omits hint segment when hint is not provided", () => {
		tempRoot = createMemoryRoot();
		const now = new Date(2026, 3, 20, 14, 32);

		appendNote({
			content: "untagged",
			sessionId: "abc",
			memoryRoot: tempRoot,
			now,
		});

		const content = readFileSync(dailyPath(tempRoot, now), "utf-8");
		expect(content).toContain("- 14:32 [routine] untagged\n");
		expect(content).not.toContain("[[");
	});

	test("defaults salience to routine", () => {
		tempRoot = createMemoryRoot();
		const now = new Date(2026, 3, 20, 14, 32);

		appendNote({
			content: "default salience",
			sessionId: "abc",
			memoryRoot: tempRoot,
			now,
		});

		const content = readFileSync(dailyPath(tempRoot, now), "utf-8");
		expect(content).toContain("[routine]");
	});

	test("rejects salience outside the closed vocabulary", () => {
		const root = createMemoryRoot();
		tempRoot = root;
		const now = new Date(2026, 3, 20, 14, 32);

		expect(() =>
			appendNote({
				content: "bad",
				salience: "question",
				sessionId: "abc",
				memoryRoot: root,
				now,
			}),
		).toThrow(/salience/i);
	});

	test("preserves existing unrelated content when appending", () => {
		tempRoot = createMemoryRoot();
		const now = new Date(2026, 3, 20, 14, 32);

		appendNote({
			content: "first",
			sessionId: "abc",
			memoryRoot: tempRoot,
			now,
		});
		appendNote({
			content: "second",
			sessionId: "abc",
			memoryRoot: tempRoot,
			now: new Date(2026, 3, 20, 14, 45),
		});

		const content = readFileSync(dailyPath(tempRoot, now), "utf-8");
		expect(content.indexOf("first")).toBeLessThan(content.indexOf("second"));
	});

	test("trims trailing whitespace on content but preserves internal", () => {
		tempRoot = createMemoryRoot();
		const now = new Date(2026, 3, 20, 14, 32);

		appendNote({
			content: "  hello  world  \n",
			sessionId: "abc",
			memoryRoot: tempRoot,
			now,
		});

		const content = readFileSync(dailyPath(tempRoot, now), "utf-8");
		expect(content).toContain("- 14:32 [routine] hello  world\n");
	});

	test("renders multi-line content as bullet + indented continuation", () => {
		tempRoot = createMemoryRoot();
		const now = new Date(2026, 3, 20, 14, 32);

		appendNote({
			content: "first line\nsecond line\nthird line",
			sessionId: "abc",
			memoryRoot: tempRoot,
			now,
		});

		const content = readFileSync(dailyPath(tempRoot, now), "utf-8");
		expect(content).toContain(
			"- 14:32 [routine] first line\n  second line\n  third line\n",
		);
		// Only one bullet header for the entry.
		const bulletCount = content.match(/^- \d\d:\d\d /gm)?.length ?? 0;
		expect(bulletCount).toBe(1);
	});

	test("keeps hint attached to the bullet line, not continuation", () => {
		tempRoot = createMemoryRoot();
		const now = new Date(2026, 3, 20, 14, 32);

		appendNote({
			content: "first line\nsecond line",
			hint: "outclaw",
			sessionId: "abc",
			memoryRoot: tempRoot,
			now,
		});

		const content = readFileSync(dailyPath(tempRoot, now), "utf-8");
		expect(content).toContain("- 14:32 [routine] first line [[outclaw]]\n");
		expect(content).toContain("  second line\n");
	});
});
