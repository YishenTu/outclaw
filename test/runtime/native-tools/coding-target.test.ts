import { describe, expect, test } from "bun:test";
import {
	type NativeCodingRepositoryLookup,
	resolveNativeCodingStartCwd,
} from "../../../src/runtime/native-tools/coding-target.ts";

function repositories(): NativeCodingRepositoryLookup {
	const byId = new Map([
		["repo-1", { id: "repo-1", rootCwd: "/work/outclaw" }],
	]);
	const byRoot = new Map([
		["/work/outclaw", { id: "repo-1", rootCwd: "/work/outclaw" }],
	]);
	return {
		get: (id) => byId.get(id),
		getByRoot: (rootCwd) => byRoot.get(rootCwd),
	};
}

describe("resolveNativeCodingStartCwd", () => {
	test("prefers explicit cwd when provided", () => {
		expect(
			resolveNativeCodingStartCwd(repositories(), {
				target: "repo-1",
				cwd: "/work/outclaw/packages/app",
			}),
		).toBe("/work/outclaw/packages/app");
	});

	test("resolves repository ids returned by native coding list", () => {
		expect(
			resolveNativeCodingStartCwd(repositories(), { target: "repo-1" }),
		).toBe("/work/outclaw");
	});

	test("accepts registered repository root paths", () => {
		expect(
			resolveNativeCodingStartCwd(repositories(), { target: "/work/outclaw" }),
		).toBe("/work/outclaw");
	});

	test("leaves unknown targets as caller-provided paths", () => {
		expect(
			resolveNativeCodingStartCwd(repositories(), { target: "../scratch" }),
		).toBe("../scratch");
	});
});
