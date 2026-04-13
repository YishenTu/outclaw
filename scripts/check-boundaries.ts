/**
 * Verify architectural import boundaries from AGENTS.md:
 *
 *   common/  ← backend/  ← runtime/  ← frontend/
 *
 * - common/ imports nothing internal
 * - backend/ imports common/ only
 * - runtime/ imports common/ and backend/
 * - frontend/ imports common/ only
 * - runtime/ must not import provider SDKs
 */

type Layer = "common" | "backend" | "runtime" | "frontend";

const ALLOWED: Record<Layer, Layer[]> = {
	common: [],
	backend: ["common"],
	runtime: ["common", "backend"],
	frontend: ["common"],
};

const LAYERS: Layer[] = ["common", "backend", "runtime", "frontend"];

const PROVIDER_SDKS = ["@anthropic-ai/claude-agent-sdk"];

const IMPORT_RE = /(?:from|import)\s+["']([^"']+)["']/g;

async function main() {
	const violations: string[] = [];

	for (const layer of LAYERS) {
		const forbidden = LAYERS.filter(
			(l) => l !== layer && !ALLOWED[layer].includes(l),
		);
		const glob = new Bun.Glob(`src/${layer}/**/*.{ts,tsx}`);

		for await (const path of glob.scan(".")) {
			const content = await Bun.file(path).text();

			for (const [lineNo, line] of content.split("\n").entries()) {
				for (const match of line.matchAll(IMPORT_RE)) {
					const spec = match[1];
					if (!spec) {
						continue;
					}

					// External package — only check provider SDK rule
					if (!spec.startsWith(".")) {
						if (
							layer === "runtime" &&
							PROVIDER_SDKS.some((sdk) => spec.startsWith(sdk))
						) {
							violations.push(
								`${path}:${lineNo + 1}: runtime/ imports provider SDK "${spec}"`,
							);
						}
						continue;
					}

					// Relative import — check layer boundaries
					for (const f of forbidden) {
						if (spec.includes(`/${f}/`) || spec.startsWith(`../${f}/`)) {
							violations.push(
								`${path}:${lineNo + 1}: ${layer}/ imports from ${f}/ — "${spec}"`,
							);
						}
					}
				}
			}
		}
	}

	if (violations.length > 0) {
		console.error("Architecture boundary violations:\n");
		for (const v of violations) {
			console.error(`  ${v}`);
		}
		process.exit(1);
	}

	console.log("Architecture boundaries: OK");
}

main();
