import { secureAgentConfig } from "../runtime/config/secure-agent-config.ts";

interface ConfigCommandOptions {
	argv: string[];
	homeDir: string;
	printUsage: () => void;
}

export function configCommand(options: ConfigCommandOptions) {
	const subcommand = options.argv[3];
	switch (subcommand) {
		case "secure":
			configSecureCommand(options.homeDir);
			return;
		default:
			options.printUsage();
			process.exit(1);
	}
}

function configSecureCommand(homeDir: string) {
	const result = secureAgentConfig(homeDir);
	if (result.changes.length === 0) {
		console.log("No hardcoded agent telegram config found in config.json");
		return;
	}

	for (const change of result.changes) {
		console.log(`config.json: ${change.path} -> $${change.envKey}`);
	}
	console.log("Updated .env");
}
