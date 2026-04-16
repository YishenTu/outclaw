interface LaunchBrowserFrontendOptions {
	argv: string[];
	browserDir: string;
	runtimeRunning: boolean;
}

interface LaunchBrowserFrontendDependencies {
	env?: NodeJS.ProcessEnv;
	log?: (message: string) => void;
	spawnSync?: typeof Bun.spawnSync;
}

export function launchBrowserFrontend(
	options: LaunchBrowserFrontendOptions,
	dependencies: LaunchBrowserFrontendDependencies = {},
) {
	const env = dependencies.env ?? process.env;
	const log = dependencies.log ?? console.log;
	const spawnSync = dependencies.spawnSync ?? Bun.spawnSync;
	const extraArgs = options.argv.slice(3);

	if (!options.runtimeRunning) {
		log(
			"Daemon is not running. Browser will connect once you start it with `oc start`.",
		);
	}

	spawnSync(["bun", "run", "dev", ...extraArgs], {
		cwd: options.browserDir,
		env,
		stdio: ["inherit", "inherit", "inherit"],
	});
}
