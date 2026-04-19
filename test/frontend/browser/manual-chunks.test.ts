import { describe, expect, test } from "bun:test";
import {
	extractNodeModulePackageName,
	manualChunkForBrowserModule,
} from "../../../src/frontend/browser/build/manual-chunks.ts";

describe("extractNodeModulePackageName", () => {
	test("returns undefined for app source files", () => {
		expect(
			extractNodeModulePackageName(
				"/Users/test/outclaw/src/frontend/browser/app.tsx",
			),
		).toBeUndefined();
	});

	test("extracts regular package names", () => {
		expect(
			extractNodeModulePackageName(
				"/Users/test/outclaw/node_modules/react-markdown/index.js",
			),
		).toBe("react-markdown");
	});

	test("extracts scoped package names", () => {
		expect(
			extractNodeModulePackageName(
				"/Users/test/outclaw/node_modules/@xterm/xterm/lib/xterm.js",
			),
		).toBe("@xterm/xterm");
	});

	test("extracts nested package names from pnpm-style layouts", () => {
		expect(
			extractNodeModulePackageName(
				"/Users/test/outclaw/node_modules/.pnpm/react@19.2.4/node_modules/react/index.js",
			),
		).toBe("react");
	});
});

describe("manualChunkForBrowserModule", () => {
	test("splits react and shared ui packages", () => {
		expect(
			manualChunkForBrowserModule(
				"/Users/test/outclaw/node_modules/react/index.js",
			),
		).toBe("vendor-react");
		expect(
			manualChunkForBrowserModule(
				"/Users/test/outclaw/node_modules/lucide-react/dist/esm/lucide-react.js",
			),
		).toBe("vendor-react");
	});

	test("groups markdown rendering packages into the markdown chunk", () => {
		expect(
			manualChunkForBrowserModule(
				"/Users/test/outclaw/node_modules/react-markdown/index.js",
			),
		).toBe("vendor-markdown");
		expect(
			manualChunkForBrowserModule(
				"/Users/test/outclaw/node_modules/highlight.js/lib/index.js",
			),
		).toBe("vendor-markdown");
		expect(
			manualChunkForBrowserModule(
				"/Users/test/outclaw/node_modules/rehype-highlight/index.js",
			),
		).toBe("vendor-markdown");
	});

	test("groups math rendering packages into the math chunk", () => {
		expect(
			manualChunkForBrowserModule(
				"/Users/test/outclaw/node_modules/remark-math/index.js",
			),
		).toBe("vendor-math");
		expect(
			manualChunkForBrowserModule(
				"/Users/test/outclaw/node_modules/rehype-katex/index.js",
			),
		).toBe("vendor-math");
		expect(
			manualChunkForBrowserModule(
				"/Users/test/outclaw/node_modules/katex/dist/katex.mjs",
			),
		).toBe("vendor-math");
	});

	test("splits terminal packages", () => {
		expect(
			manualChunkForBrowserModule(
				"/Users/test/outclaw/node_modules/@xterm/xterm/lib/xterm.js",
			),
		).toBe("vendor-terminal");
	});

	test("splits git graph packages", () => {
		expect(
			manualChunkForBrowserModule(
				"/Users/test/outclaw/node_modules/commit-graph/dist/index.js",
			),
		).toBe("vendor-git");
	});

	test("leaves unmatched packages and app modules on the default chunking path", () => {
		expect(
			manualChunkForBrowserModule(
				"/Users/test/outclaw/node_modules/diff/lib/index.js",
			),
		).toBeUndefined();
		expect(
			manualChunkForBrowserModule(
				"/Users/test/outclaw/src/frontend/browser/components/chat/message.tsx",
			),
		).toBeUndefined();
	});
});
