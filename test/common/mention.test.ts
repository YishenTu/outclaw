import { describe, expect, test } from "bun:test";
import {
	detectMentionToken,
	matchMentionEntries,
	replaceMentionToken,
} from "../../src/common/mention.ts";
import type { WorkspaceFileEntry } from "../../src/common/protocol.ts";

describe("detectMentionToken", () => {
	test("returns null when no @ token is active", () => {
		expect(detectMentionToken("hello world", 5)).toBeNull();
	});

	test("returns the @ position when typing at the start", () => {
		expect(detectMentionToken("@src", 4)).toEqual({
			start: 0,
			end: 4,
			query: "src",
		});
	});

	test("returns the @ position when preceded by whitespace", () => {
		expect(detectMentionToken("hello @rea", 10)).toEqual({
			start: 6,
			end: 10,
			query: "rea",
		});
	});

	test("returns the @ position when preceded by a newline", () => {
		expect(detectMentionToken("first line\n@s", 13)).toEqual({
			start: 11,
			end: 13,
			query: "s",
		});
	});

	test("returns a quoted @ token with whitespace in the query", () => {
		const value = 'see @"docs/user gu';
		expect(detectMentionToken(value, value.length)).toEqual({
			start: 4,
			end: value.length,
			query: "docs/user gu",
		});
	});

	test("returns null when @ is glued to non-whitespace", () => {
		expect(detectMentionToken("user@host", 9)).toBeNull();
	});

	test("returns null when whitespace appears after the @", () => {
		expect(detectMentionToken("@src foo", 8)).toBeNull();
	});

	test("treats bare @ as an active token with empty query", () => {
		expect(detectMentionToken("@", 1)).toEqual({
			start: 0,
			end: 1,
			query: "",
		});
	});

	test("ignores @ that comes after the cursor", () => {
		expect(detectMentionToken("hi @src", 2)).toBeNull();
	});

	test("returns null after a quoted @ token has been closed", () => {
		const value = 'see @"docs/user guide.md" ';
		expect(detectMentionToken(value, value.length)).toBeNull();
	});
});

describe("matchMentionEntries", () => {
	const entries: WorkspaceFileEntry[] = [
		{ kind: "file", path: "README.md" },
		{ kind: "directory", path: "src" },
		{ kind: "file", path: "src/index.ts" },
		{ kind: "directory", path: "src/runtime" },
		{ kind: "file", path: "src/runtime/agent.ts" },
		{ kind: "file", path: "test/index.test.ts" },
	];

	test("returns all entries when query is empty", () => {
		expect(matchMentionEntries(entries, "").length).toBe(entries.length);
	});

	test("ranks basename-prefix matches above path-prefix matches", () => {
		const matches = matchMentionEntries(entries, "ind");
		expect(matches[0]?.path).toBe("src/index.ts");
		expect(matches[1]?.path).toBe("test/index.test.ts");
	});

	test("ranks path-prefix matches above mid-string matches", () => {
		const matches = matchMentionEntries(entries, "src");
		expect(matches.map((entry) => entry.path)).toContain("src");
		expect(matches.map((entry) => entry.path)[0]).toBe("src");
	});

	test("filters out entries that do not match", () => {
		const matches = matchMentionEntries(entries, "agent");
		expect(matches.map((entry) => entry.path)).toEqual([
			"src/runtime/agent.ts",
		]);
	});

	test("matching is case-insensitive", () => {
		const matches = matchMentionEntries(entries, "README");
		expect(matches[0]?.path).toBe("README.md");
	});

	test("limits ranked matches after scoring", () => {
		const matches = matchMentionEntries(entries, "index", { limit: 1 });
		expect(matches.map((entry) => entry.path)).toEqual(["src/index.ts"]);
	});
});

describe("replaceMentionToken", () => {
	test("replaces the @-token with @path and trailing space", () => {
		const result = replaceMentionToken(
			"see @ind",
			{ start: 4, end: 8, query: "ind" },
			"src/index.ts",
		);
		expect(result.value).toBe("see @src/index.ts ");
		expect(result.cursor).toBe("see @src/index.ts ".length);
	});

	test("replaces in the middle of a string preserving suffix", () => {
		const result = replaceMentionToken(
			"see @ind here",
			{ start: 4, end: 8, query: "ind" },
			"src/index.ts",
		);
		expect(result.value).toBe("see @src/index.ts here");
	});

	test("quotes paths containing whitespace", () => {
		const result = replaceMentionToken(
			"see @guide",
			{ start: 4, end: 10, query: "guide" },
			"docs/user guide.md",
		);
		expect(result.value).toBe('see @"docs/user guide.md" ');
		expect(result.cursor).toBe('see @"docs/user guide.md" '.length);
	});
});
