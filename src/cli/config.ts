import { secureAgentConfig } from "../runtime/config/secure-agent-config.ts";
import {
	type GlobalConfigPatch,
	updateGlobalConfig,
} from "../runtime/config.ts";
import { maybeMarkRestartRequired } from "./restart-required.ts";
import {
	formatConfigRuntimeUsage,
	hasHelpFlag,
	isHelpFlag,
	printConfigRuntimeUsage,
	printConfigSecureUsage,
	printConfigUsage,
} from "./usage.ts";

interface ConfigCommandOptions {
	argv: string[];
	homeDir: string;
}

export function configCommand(options: ConfigCommandOptions) {
	const subcommand = options.argv[3];
	if (subcommand === undefined || isHelpFlag(subcommand)) {
		printConfigUsage();
		process.exit(subcommand === undefined ? 1 : 0);
	}

	switch (subcommand) {
		case "runtime":
			configRuntimeCommand(options.homeDir, options.argv.slice(4));
			return;
		case "secure":
			configSecureCommand(options.homeDir, options.argv.slice(4));
			return;
		default:
			printConfigUsage();
			process.exit(1);
	}
}

function configRuntimeCommand(homeDir: string, args: string[]) {
	if (hasHelpFlag(args)) {
		printConfigRuntimeUsage();
		process.exit(0);
	}
	const patch = parseRuntimeFlags(args);
	if (
		patch.port === undefined &&
		patch.host === undefined &&
		patch.autoCompact === undefined &&
		patch.heartbeat?.intervalMinutes === undefined &&
		patch.heartbeat?.deferMinutes === undefined
	) {
		console.error(formatConfigRuntimeUsage());
		process.exit(1);
	}

	updateGlobalConfig(homeDir, patch);
	console.log("Configured runtime settings");
	maybeMarkRestartRequired(homeDir);
}

function configSecureCommand(homeDir: string, args: string[]) {
	if (hasHelpFlag(args)) {
		printConfigSecureUsage();
		process.exit(0);
	}

	const result = secureAgentConfig(homeDir);
	if (result.changes.length === 0) {
		console.log("No hardcoded agent telegram config found in config.json");
		return;
	}

	for (const change of result.changes) {
		console.log(`config.json: ${change.path} -> $${change.envKey}`);
	}
	console.log("Updated .env");
	maybeMarkRestartRequired(homeDir);
}

function parseRuntimeFlags(args: string[]) {
	const patch: GlobalConfigPatch = {};

	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index];
		if (!flag?.startsWith("--")) {
			console.error(`Unexpected argument: ${flag}`);
			process.exit(1);
		}

		const value = args[index + 1];
		if (!value || value.startsWith("--")) {
			console.error(`Missing value for ${flag}`);
			process.exit(1);
		}

		switch (flag) {
			case "--host":
				patch.host = parseHost(value, "--host");
				break;
			case "--port":
				patch.port = parseNonNegativeInteger(value, "--port");
				break;
			case "--auto-compact":
				patch.autoCompact = parseBoolean(value, "--auto-compact");
				break;
			case "--heartbeat-interval":
				patch.heartbeat = {
					...patch.heartbeat,
					intervalMinutes: parseNonNegativeInteger(
						value,
						"--heartbeat-interval",
					),
				};
				break;
			case "--heartbeat-defer":
				patch.heartbeat = {
					...patch.heartbeat,
					deferMinutes: parseNonNegativeInteger(value, "--heartbeat-defer"),
				};
				break;
			default:
				console.error(`Unknown flag: ${flag}`);
				process.exit(1);
		}

		index += 1;
	}

	return patch;
}

function parseHost(value: string, flag: string): string {
	if (value.trim() === "") {
		console.error(`Invalid ${flag} value: ${value} (expected non-empty host)`);
		process.exit(1);
	}
	return value;
}

function parseBoolean(value: string, flag: string): boolean {
	if (value === "true") {
		return true;
	}
	if (value === "false") {
		return false;
	}

	console.error(`Invalid ${flag} value: ${value} (expected true or false)`);
	process.exit(1);
}

function parseNonNegativeInteger(value: string, flag: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 0 || `${parsed}` !== value) {
		console.error(
			`Invalid ${flag} value: ${value} (expected non-negative integer)`,
		);
		process.exit(1);
	}
	return parsed;
}
