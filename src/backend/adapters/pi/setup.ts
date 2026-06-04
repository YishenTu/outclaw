import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OUTCLAW_EXTENSION_ENTRIES = ["./web-tools.ts", "./default-tools.ts"];

export interface PiProfilePaths {
	agentDir: string;
	extensionDir: string;
	sharedAuthFile: string;
}

export function getPiProfilePaths(homeDir: string = homedir()): PiProfilePaths {
	return {
		agentDir: join(homeDir, ".pi", "outclaw", "agent"),
		extensionDir: join(homeDir, ".pi", "outclaw", "agent", "extensions"),
		sharedAuthFile: join(homeDir, ".pi", "agent", "auth.json"),
	};
}

export function ensurePiProfile(paths: PiProfilePaths = getPiProfilePaths()) {
	mkdirSync(paths.agentDir, { recursive: true });
	mkdirSync(paths.extensionDir, { recursive: true });
	ensureExtensionManifest(paths.extensionDir);
}

export function ensurePiAgentWorkspace(promptHomeDir: string): void {
	mkdirSync(join(promptHomeDir, "skills"), { recursive: true });
}

function ensureExtensionManifest(extensionDir: string): void {
	const packageJsonPath = join(extensionDir, "package.json");
	const packageJson = readPackageJson(packageJsonPath);
	const piConfig = isRecord(packageJson.pi) ? packageJson.pi : {};
	const existingExtensions = Array.isArray(piConfig.extensions)
		? piConfig.extensions.filter(
				(entry): entry is string => typeof entry === "string",
			)
		: [];
	const extensions = mergeExtensionEntries(existingExtensions);
	const nextPackageJson = {
		...packageJson,
		pi: {
			...piConfig,
			extensions,
		},
	};

	if (JSON.stringify(packageJson) === JSON.stringify(nextPackageJson)) {
		return;
	}

	writeFileSync(
		packageJsonPath,
		`${JSON.stringify(nextPackageJson, null, 2)}\n`,
	);
}

function readPackageJson(packageJsonPath: string): Record<string, unknown> {
	if (!existsSync(packageJsonPath)) {
		return {};
	}

	try {
		const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function mergeExtensionEntries(existingExtensions: string[]): string[] {
	const outclawEntries = new Set(OUTCLAW_EXTENSION_ENTRIES);
	return [
		...OUTCLAW_EXTENSION_ENTRIES,
		...existingExtensions.filter((entry) => !outclawEntries.has(entry)),
	];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
