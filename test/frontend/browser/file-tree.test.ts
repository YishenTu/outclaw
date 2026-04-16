import { describe, expect, test } from "bun:test";
import {
	fileKindForPath,
	fileNodePaddingLeft,
	isTreeNodeExpanded,
	treeNodePaddingLeft,
} from "../../../src/frontend/browser/components/right-panel/file-tree.tsx";

describe("file tree helpers", () => {
	test("folders are collapsed by default", () => {
		expect(isTreeNodeExpanded({}, "src")).toBe(false);
		expect(isTreeNodeExpanded({ src: true }, "src")).toBe(true);
	});

	test("nested entries use deeper indentation", () => {
		expect(treeNodePaddingLeft(0)).toBe("12px");
		expect(treeNodePaddingLeft(1)).toBe("30px");
		expect(treeNodePaddingLeft(2)).toBe("48px");
		expect(fileNodePaddingLeft(0)).toBe("34px");
		expect(fileNodePaddingLeft(1)).toBe("52px");
	});

	test("chooses file kinds from file extensions", () => {
		expect(fileKindForPath("README.md")).toBe("markdown");
		expect(fileKindForPath("src/index.ts")).toBe("code");
		expect(fileKindForPath("package.json")).toBe("json");
		expect(fileKindForPath("screenshot.png")).toBe("image");
		expect(fileKindForPath("notes.txt")).toBe("default");
	});
});
