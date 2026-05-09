import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildAgentGraph,
	clearAgentGraphCache,
} from "../../../../src/runtime/browser/files/build-graph.ts";

afterEach(() => {
	clearAgentGraphCache();
});

function makeTempRoot(prefix: string): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), prefix));
	return {
		root,
		cleanup: () => rmSync(root, { force: true, recursive: true }),
	};
}

describe("buildAgentGraph", () => {
	test("returns one resolved node per markdown file, no links when nothing references", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-graph-empty-");
		try {
			writeFileSync(join(root, "alpha.md"), "no links here");
			writeFileSync(join(root, "beta.md"), "still nothing");

			const graph = await buildAgentGraph(root);

			expect(graph.nodes).toEqual([
				{ id: "alpha.md", name: "alpha", path: "alpha.md", resolved: true },
				{ id: "beta.md", name: "beta", path: "beta.md", resolved: true },
			]);
			expect(graph.links).toEqual([]);
		} finally {
			cleanup();
		}
	});

	test("resolves wikilinks by basename across folders", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-graph-resolve-");
		try {
			mkdirSync(join(root, "schemas"));
			writeFileSync(join(root, "schemas", "yishen.md"), "");
			writeFileSync(
				join(root, "MEMORY.md"),
				"See [[Yishen]] and [[yishen|the boss]]",
			);

			const graph = await buildAgentGraph(root);

			const ids = graph.nodes.map((node) => node.id).sort();
			expect(ids).toEqual(["MEMORY.md", "schemas/yishen.md"]);
			expect(graph.links).toEqual([
				{ source: "MEMORY.md", target: "schemas/yishen.md" },
				{ source: "MEMORY.md", target: "schemas/yishen.md" },
			]);
		} finally {
			cleanup();
		}
	});

	test("creates unresolved nodes for missing targets", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-graph-unresolved-");
		try {
			writeFileSync(join(root, "a.md"), "[[Ghost]] and [[real]]");
			writeFileSync(join(root, "real.md"), "");

			const graph = await buildAgentGraph(root);

			const ghost = graph.nodes.find((node) => !node.resolved);
			expect(ghost).toEqual({
				id: "unresolved:ghost",
				name: "Ghost",
				path: null,
				resolved: false,
			});
			expect(graph.links).toEqual([
				{ source: "a.md", target: "unresolved:ghost" },
				{ source: "a.md", target: "real.md" },
			]);
		} finally {
			cleanup();
		}
	});

	test("strips fenced code blocks before extracting wikilinks", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-graph-codefence-");
		try {
			writeFileSync(join(root, "real.md"), "");
			writeFileSync(
				join(root, "src.md"),
				[
					"Outside [[real]]",
					"```",
					"echo '[[fake]]'",
					"```",
					"After [[real]]",
				].join("\n"),
			);

			const graph = await buildAgentGraph(root);

			const targets = graph.links
				.filter((link) => link.source === "src.md")
				.map((link) => link.target);
			expect(targets).toEqual(["real.md", "real.md"]);
		} finally {
			cleanup();
		}
	});

	test("ignores heading and block anchors when resolving", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-graph-anchors-");
		try {
			writeFileSync(join(root, "target.md"), "");
			writeFileSync(
				join(root, "src.md"),
				"[[target#section]] and [[target#^block-id]]",
			);

			const graph = await buildAgentGraph(root);

			const targets = graph.links.map((link) => link.target);
			expect(targets).toEqual(["target.md", "target.md"]);
		} finally {
			cleanup();
		}
	});

	test("skips non-markdown files and ignored directories", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-graph-skip-");
		try {
			mkdirSync(join(root, "node_modules"));
			writeFileSync(join(root, "node_modules", "noise.md"), "[[ghost]]");
			writeFileSync(join(root, "code.ts"), "[[ghost]]");
			writeFileSync(join(root, "real.md"), "");

			const graph = await buildAgentGraph(root);

			expect(graph.nodes.map((node) => node.id)).toEqual(["real.md"]);
			expect(graph.links).toEqual([]);
		} finally {
			cleanup();
		}
	});

	test("strips indented code blocks before extracting wikilinks", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-graph-indent-");
		try {
			writeFileSync(join(root, "real.md"), "");
			writeFileSync(
				join(root, "src.md"),
				[
					"Inline [[real]]",
					"",
					"    [[indented-fake]]",
					"\t[[tab-indented-fake]]",
					"",
					"After [[real]]",
				].join("\n"),
			);

			const graph = await buildAgentGraph(root);

			const targets = graph.links
				.filter((link) => link.source === "src.md")
				.map((link) => link.target)
				.sort();
			expect(targets).toEqual(["real.md", "real.md"]);
			// Indented "fake" wikilinks must not produce ghost nodes.
			expect(
				graph.nodes.some(
					(node) =>
						node.id.startsWith("unresolved:") && node.name.includes("fake"),
				),
			).toBe(false);
		} finally {
			cleanup();
		}
	});

	test("reuses cached parse when mtime is unchanged", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-graph-cache-");
		try {
			const fixedTime = new Date("2026-01-01T00:00:00.000Z");
			writeFileSync(join(root, "src.md"), "[[ghost]]");
			utimesSync(join(root, "src.md"), fixedTime, fixedTime);
			const first = await buildAgentGraph(root);
			expect(
				first.nodes.find((node) => node.id === "unresolved:ghost"),
			).toBeDefined();

			// Replace the file content, but reset mtime to the original. Cache
			// must trust mtime over content here — that is the contract.
			const originalStat = statSync(join(root, "src.md"));
			writeFileSync(join(root, "src.md"), "[[different-target]]");
			utimesSync(join(root, "src.md"), originalStat.atime, originalStat.mtime);

			const second = await buildAgentGraph(root);
			// Cache hit: still references "ghost", not "different-target".
			expect(
				second.nodes.find((node) => node.id === "unresolved:ghost"),
			).toBeDefined();
			expect(
				second.nodes.find((node) => node.id === "unresolved:different-target"),
			).toBeUndefined();
		} finally {
			cleanup();
		}
	});

	test("invalidates cache when mtime advances", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-graph-invalidate-");
		try {
			writeFileSync(join(root, "src.md"), "[[first]]");
			const first = await buildAgentGraph(root);
			expect(
				first.nodes.find((node) => node.id === "unresolved:first"),
			).toBeDefined();

			// Advance mtime past the original by 2 seconds (filesystems vary in
			// resolution; 2s is a safe gap).
			writeFileSync(join(root, "src.md"), "[[second]]");
			const future = new Date(Date.now() + 2000);
			utimesSync(join(root, "src.md"), future, future);

			const second = await buildAgentGraph(root);
			expect(
				second.nodes.find((node) => node.id === "unresolved:second"),
			).toBeDefined();
			expect(
				second.nodes.find((node) => node.id === "unresolved:first"),
			).toBeUndefined();
		} finally {
			cleanup();
		}
	});

	test("prunes cache entries for deleted files", async () => {
		const { root, cleanup } = makeTempRoot("outclaw-graph-prune-");
		try {
			writeFileSync(join(root, "a.md"), "[[ghost-a]]");
			writeFileSync(join(root, "b.md"), "[[ghost-b]]");
			await buildAgentGraph(root);

			rmSync(join(root, "a.md"));
			const after = await buildAgentGraph(root);
			expect(after.nodes.map((node) => node.id).sort()).toEqual(
				["b.md", "unresolved:ghost-b"].sort(),
			);
		} finally {
			cleanup();
		}
	});
});
