import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../..");

function collectStaticImports(source: string) {
	return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
		(match) => match[1] ?? "",
	);
}

describe("runtime architecture", () => {
	test("runtime modules do not import provider adapter internals", async () => {
		const offenders: string[] = [];

		for await (const relativePath of new Bun.Glob("src/runtime/**/*.ts").scan(
			REPO_ROOT,
		)) {
			const file = Bun.file(resolve(REPO_ROOT, relativePath));
			const source = await file.text();
			for (const specifier of collectStaticImports(source)) {
				if (specifier.includes("backend/adapters/")) {
					offenders.push(`${relativePath}: ${specifier}`);
				}
			}
		}

		expect(offenders).toEqual([]);
	});

	test("non-backend modules do not import the Claude SDK directly", async () => {
		const offenders: string[] = [];
		const scopes = [
			"src/runtime/**/*.ts",
			"src/common/**/*.ts",
			"src/frontend/**/*.ts",
			"src/cli/**/*.ts",
		];

		for (const scope of scopes) {
			for await (const relativePath of new Bun.Glob(scope).scan(REPO_ROOT)) {
				const file = Bun.file(resolve(REPO_ROOT, relativePath));
				const source = await file.text();
				if (source.includes("@anthropic-ai/claude-agent-sdk")) {
					offenders.push(relativePath);
				}
			}
		}

		expect(offenders).toEqual([]);
	});
});
