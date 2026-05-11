import { describe, expect, test } from "bun:test";
import { parseFileLineStatus } from "../../../src/frontend/browser/components/file-viewer/parse-file-line-status.ts";

function lines(set: Set<number>): number[] {
	return Array.from(set).sort((a, b) => a - b);
}

describe("parseFileLineStatus", () => {
	test("marks pure additions as added lines", () => {
		const status = parseFileLineStatus(
			`diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,2 +1,4 @@
 first
+added one
+added two
 last
`,
			"src/file.ts",
		);

		expect(lines(status.added)).toEqual([2, 3]);
		expect(lines(status.modified)).toEqual([]);
		expect(lines(status.deletedBefore)).toEqual([]);
	});

	test("marks pure deletions before the next surviving line", () => {
		const status = parseFileLineStatus(
			`diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,2 @@
 first
-deleted
 last
`,
			"src/file.ts",
		);

		expect(lines(status.added)).toEqual([]);
		expect(lines(status.modified)).toEqual([]);
		expect(lines(status.deletedBefore)).toEqual([2]);
	});

	test("marks mixed deletion and addition runs as modified lines", () => {
		const status = parseFileLineStatus(
			`diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,4 +1,4 @@
 first
-old one
+new one
-old two
+new two
 last
`,
			"src/file.ts",
		);

		expect(lines(status.added)).toEqual([]);
		expect(lines(status.modified)).toEqual([2, 3]);
		expect(lines(status.deletedBefore)).toEqual([]);
	});

	test("marks all lines in a new file as added", () => {
		const status = parseFileLineStatus(
			`diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+one
+two
+three
`,
			"src/new.ts",
		);

		expect(lines(status.added)).toEqual([1, 2, 3]);
		expect(lines(status.modified)).toEqual([]);
		expect(lines(status.deletedBefore)).toEqual([]);
	});

	test("parses multiple hunks in one file", () => {
		const status = parseFileLineStatus(
			`diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,4 @@
 first
+added
 second
 third
@@ -10,3 +11,2 @@
 tenth
-deleted
 twelfth
`,
			"src/file.ts",
		);

		expect(lines(status.added)).toEqual([2]);
		expect(lines(status.modified)).toEqual([]);
		expect(lines(status.deletedBefore)).toEqual([12]);
	});

	test("ignores sections for other files", () => {
		const status = parseFileLineStatus(
			`diff --git a/src/other.ts b/src/other.ts
--- a/src/other.ts
+++ b/src/other.ts
@@ -1,1 +1,2 @@
 other
+ignored
diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,2 +1,2 @@
-old
+new
 keep
`,
			"src/file.ts",
		);

		expect(lines(status.added)).toEqual([]);
		expect(lines(status.modified)).toEqual([1]);
		expect(lines(status.deletedBefore)).toEqual([]);
	});

	test("ignores no-newline markers inside change runs", () => {
		const status = parseFileLineStatus(
			`diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,1 +1,1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`,
			"src/file.ts",
		);

		expect(lines(status.added)).toEqual([]);
		expect(lines(status.modified)).toEqual([1]);
		expect(lines(status.deletedBefore)).toEqual([]);
	});
});
