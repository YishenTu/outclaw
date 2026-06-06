import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	getOutclawPiExtensionBundlePath,
	isOutclawPiExtensionBundleCurrent,
	OUTCLAW_PI_EXTENSION_ENTRY,
	resolveRepoRootFromPiExtensionSourceDir,
	writeOutclawPiExtensionBundleDigest,
} from "./extension-bundle.ts";

const OUTCLAW_EXTENSION_ENTRIES = [OUTCLAW_PI_EXTENSION_ENTRY];
const OUTCLAW_MANAGED_EXTENSION_ENTRIES = [
	...OUTCLAW_EXTENSION_ENTRIES,
	"./web-tools.js",
	"./web-tools.ts",
	"./default-tools.ts",
	"./outclaw-tools.ts",
];
const OUTCLAW_LEGACY_EXTENSION_FILES = [
	"web-tools.js",
	"web-tools.ts",
	"default-tools.ts",
	"outclaw-tools.ts",
];
const OUTCLAW_MANAGED_EXTENSION_DEPENDENCIES = new Set([
	"@mozilla/readability",
	"jsdom",
	"linkedom",
	"turndown",
	"typebox",
]);

export interface PiProfilePaths {
	agentDir: string;
	extensionDir: string;
	sharedAuthFile: string;
}

export interface PiOutclawExtensionBuildParams {
	extensionSourceDir: string;
	targetFile: string;
}

export interface PiProfileSetupOptions {
	extensionSourceDir?: string;
	buildOutclawExtensionBundle?: (params: PiOutclawExtensionBuildParams) => void;
}

export function getPiProfilePaths(homeDir: string = homedir()): PiProfilePaths {
	return {
		agentDir: join(homeDir, ".pi", "outclaw", "agent"),
		extensionDir: join(homeDir, ".pi", "outclaw", "agent", "extensions"),
		sharedAuthFile: join(homeDir, ".pi", "agent", "auth.json"),
	};
}

export function ensurePiProfile(
	paths: PiProfilePaths = getPiProfilePaths(),
	options: PiProfileSetupOptions = {},
) {
	mkdirSync(paths.agentDir, { recursive: true });
	mkdirSync(paths.extensionDir, { recursive: true });
	const manifestPlan = planExtensionManifest(paths.extensionDir);
	syncOutclawExtension(paths.extensionDir, options);
	applyExtensionManifest(paths.extensionDir, manifestPlan);
}

export function ensurePiAgentWorkspace(promptHomeDir: string): void {
	mkdirSync(join(promptHomeDir, "skills"), { recursive: true });
}

interface ExtensionManifestPlan {
	nextPackageJson: Record<string, unknown>;
	changed: boolean;
}

function planExtensionManifest(extensionDir: string): ExtensionManifestPlan {
	const packageJsonPath = join(extensionDir, "package.json");
	const initialPackageJson = readPackageJson(packageJsonPath);
	const piConfig = isRecord(initialPackageJson.pi) ? initialPackageJson.pi : {};
	const existingExtensions = readExtensionEntries(piConfig);
	const customExtensions = existingExtensions.filter(
		(entry) => !OUTCLAW_MANAGED_EXTENSION_ENTRIES.includes(entry),
	);
	const packageJson = pruneManagedExtensionDependencies(initialPackageJson, {
		hasCustomExtensions: customExtensions.length > 0,
	});
	const extensions = mergeExtensionEntries(existingExtensions);
	const nextPackageJson = {
		...packageJson,
		pi: {
			...piConfig,
			extensions,
		},
	};

	return {
		nextPackageJson,
		changed:
			JSON.stringify(initialPackageJson) !== JSON.stringify(nextPackageJson),
	};
}

function applyExtensionManifest(
	extensionDir: string,
	plan: ExtensionManifestPlan,
): void {
	const packageJsonPath = join(extensionDir, "package.json");

	if (plan.changed) {
		writeFileSync(
			packageJsonPath,
			`${JSON.stringify(plan.nextPackageJson, null, 2)}\n`,
		);
	}
	cleanupLegacyManagedExtensionFiles(extensionDir, plan.nextPackageJson);
}

function readExtensionEntries(piConfig: Record<string, unknown>): string[] {
	return Array.isArray(piConfig.extensions)
		? piConfig.extensions.filter(
				(entry): entry is string => typeof entry === "string",
			)
		: [];
}

function readPackageJson(packageJsonPath: string): Record<string, unknown> {
	if (!existsSync(packageJsonPath)) {
		return {};
	}

	try {
		const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
		if (!isRecord(parsed)) {
			throw new Error("manifest must contain a JSON object");
		}
		return parsed;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(
			`Invalid Pi extension manifest at ${packageJsonPath}: ${message}`,
		);
	}
}

function mergeExtensionEntries(existingExtensions: string[]): string[] {
	const outclawEntries = new Set(OUTCLAW_MANAGED_EXTENSION_ENTRIES);
	return [
		...OUTCLAW_EXTENSION_ENTRIES,
		...existingExtensions.filter((entry) => !outclawEntries.has(entry)),
	];
}

function pruneManagedExtensionDependencies(
	packageJson: Record<string, unknown>,
	options: { hasCustomExtensions: boolean },
): Record<string, unknown> {
	if (options.hasCustomExtensions) {
		return packageJson;
	}
	const dependencies = isRecord(packageJson.dependencies)
		? Object.fromEntries(
				Object.entries(packageJson.dependencies).filter(
					([name]) => !OUTCLAW_MANAGED_EXTENSION_DEPENDENCIES.has(name),
				),
			)
		: undefined;
	const nextPackageJson = { ...packageJson };
	if (!dependencies || Object.keys(dependencies).length === 0) {
		delete nextPackageJson.dependencies;
		return nextPackageJson;
	}
	nextPackageJson.dependencies = dependencies;
	return nextPackageJson;
}

function syncOutclawExtension(
	extensionDir: string,
	options: PiProfileSetupOptions,
): void {
	const sourceDir =
		options.extensionSourceDir ??
		join(dirname(fileURLToPath(import.meta.url)), "extensions");
	ensureOutclawExtensionBundle(sourceDir, extensionDir, options);
}

function ensureOutclawExtensionBundle(
	sourceDir: string,
	extensionDir: string,
	options: PiProfileSetupOptions,
): void {
	const bundlePath = getOutclawPiExtensionBundlePath(extensionDir);
	if (isOutclawPiExtensionBundleCurrent(bundlePath, sourceDir)) {
		return;
	}

	mkdirSync(dirname(bundlePath), { recursive: true });
	const buildOutclawExtensionBundle =
		options.buildOutclawExtensionBundle ?? buildProfileOutclawExtensionBundle;
	buildOutclawExtensionBundle({
		extensionSourceDir: sourceDir,
		targetFile: bundlePath,
	});
	if (existsSync(bundlePath)) {
		writeOutclawPiExtensionBundleDigest(bundlePath);
	}
	if (!isOutclawPiExtensionBundleCurrent(bundlePath, sourceDir)) {
		throw new Error(
			`Outclaw Pi extension bundle was not generated or is stale: ${bundlePath}`,
		);
	}
}

function buildProfileOutclawExtensionBundle({
	extensionSourceDir,
	targetFile,
}: PiOutclawExtensionBuildParams): void {
	const repoRoot = resolveRepoRootFromPiExtensionSourceDir(extensionSourceDir);
	const scriptPath = join(repoRoot, "scripts", "build-pi-extension.ts");
	const tempTarget = `${targetFile}.${process.pid}-${Date.now()}.tmp.js`;
	rmSync(tempTarget, { force: true });
	const result = spawnSync(
		process.execPath,
		["run", scriptPath, "--out", tempTarget],
		{
			cwd: repoRoot,
			encoding: "utf8",
			stdio: "pipe",
		},
	);
	if (result.error) {
		rmSync(tempTarget, { force: true });
		throw result.error;
	}
	if (result.status !== 0) {
		rmSync(tempTarget, { force: true });
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
		throw new Error(
			`Failed to build Outclaw Pi extension bundle with ${scriptPath}.${
				output ? `\n${output}` : ""
			}`,
		);
	}
	renameSync(tempTarget, targetFile);
}

function cleanupLegacyManagedExtensionFiles(
	extensionDir: string,
	packageJson: Record<string, unknown>,
): void {
	for (const fileName of OUTCLAW_LEGACY_EXTENSION_FILES) {
		rmSync(join(extensionDir, fileName), { force: true });
	}
	if (isRecord(packageJson.dependencies)) {
		return;
	}
	rmSync(join(extensionDir, "node_modules"), { recursive: true, force: true });
	rmSync(join(extensionDir, "package-lock.json"), { force: true });
	rmSync(join(extensionDir, "bun.lock"), { force: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
