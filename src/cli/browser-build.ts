import { existsSync } from "node:fs";
import { join } from "node:path";

interface EnsureBrowserBuildOptions {
	browserDir: string;
}

interface EnsureBrowserBuildDependencies {
	env?: NodeJS.ProcessEnv;
	log?: (message: string) => void;
	spawnSync?: typeof Bun.spawnSync;
}

const DIST_DIRNAME = "dist";
const INDEX_FILENAME = "index.html";

export function buildBrowserFrontend(
	options: EnsureBrowserBuildOptions,
	dependencies: EnsureBrowserBuildDependencies = {},
) {
	const env = dependencies.env ?? process.env;
	const log = dependencies.log ?? console.log;
	const spawnSync = dependencies.spawnSync ?? Bun.spawnSync;

	log("Building browser frontend...");
	const result = spawnSync(["bun", "run", "build"], {
		cwd: options.browserDir,
		env,
		stdio: ["inherit", "inherit", "inherit"],
	});
	if (result.exitCode !== 0) {
		throw new Error("Browser frontend build failed");
	}
}

export function ensureBrowserBuild(
	options: EnsureBrowserBuildOptions,
	dependencies: EnsureBrowserBuildDependencies = {},
) {
	const distIndexPath = join(options.browserDir, DIST_DIRNAME, INDEX_FILENAME);
	if (existsSync(distIndexPath)) {
		return;
	}
	buildBrowserFrontend(options, dependencies);
}
