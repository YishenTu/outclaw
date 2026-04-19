import {
	type GlobalConfigPatch,
	updateGlobalConfig,
} from "../runtime/config.ts";
import { formatStartUsage } from "./usage.ts";

export function applyStartRuntimeFlags(homeDir: string, args: string[]) {
	const patch = parseStartRuntimeFlags(args);

	if (patch.host === undefined) {
		return;
	}

	updateGlobalConfig(homeDir, patch);
}

function parseStartRuntimeFlags(args: string[]): GlobalConfigPatch {
	let host: string | undefined;

	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index];

		switch (flag) {
			case "--lan":
				host = selectHost(host, "0.0.0.0");
				break;
			case "--host": {
				const value = args[index + 1];
				if (!value || value.startsWith("--")) {
					fail(`Missing value for ${flag}`);
				}
				host = selectHost(host, parseHost(value, flag));
				index += 1;
				break;
			}
			default:
				fail(`Unknown flag: ${flag}`);
		}
	}

	return host === undefined ? {} : { host };
}

function selectHost(current: string | undefined, next: string): string {
	if (current !== undefined) {
		fail("Cannot combine multiple host flags");
	}

	return next;
}

function parseHost(value: string, flag: string): string {
	if (value.trim() === "") {
		fail(`Invalid ${flag} value: ${value} (expected non-empty host)`);
	}

	return value;
}

function fail(message: string): never {
	console.error(message);
	console.error(formatStartUsage());
	process.exit(1);
}
