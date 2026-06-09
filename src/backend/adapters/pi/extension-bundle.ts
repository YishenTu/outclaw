import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const OUTCLAW_PI_EXTENSION_DIR = "outclaw";
export const OUTCLAW_PI_EXTENSION_BUNDLE_FILE = "index.js";
export const OUTCLAW_PI_EXTENSION_BUNDLE_DIGEST_FILE = `${OUTCLAW_PI_EXTENSION_BUNDLE_FILE}.sha256`;
export const OUTCLAW_PI_EXTENSION_ENTRY = `./${OUTCLAW_PI_EXTENSION_DIR}/${OUTCLAW_PI_EXTENSION_BUNDLE_FILE}`;
export const OUTCLAW_PI_EXTENSION_SOURCE_FILE = "outclaw-extension.ts";
export const OUTCLAW_PI_EXTENSION_FINGERPRINT_PREFIX =
	"// outclaw-pi-extension-sha256=";

const EXTENSION_SOURCE_FILES = [
	OUTCLAW_PI_EXTENSION_SOURCE_FILE,
	"fast-mode.ts",
	"web-tools.ts",
	"default-tools.ts",
	"outclaw-tools.ts",
];
const REPO_FINGERPRINT_FILES = [
	"package.json",
	"bun.lock",
	"scripts/build-pi-extension.ts",
	"src/backend/adapters/pi/extension-bundle.ts",
];
const REQUIRED_BUNDLE_TEXT = [
	"web_search",
	"web_fetch",
	"outclaw_peer_message",
];

export function resolveRepoRootFromPiExtensionSourceDir(
	extensionSourceDir: string,
): string {
	return join(extensionSourceDir, "../../../../..");
}

export function getOutclawPiExtensionBundlePath(extensionDir: string): string {
	return join(
		extensionDir,
		OUTCLAW_PI_EXTENSION_DIR,
		OUTCLAW_PI_EXTENSION_BUNDLE_FILE,
	);
}

export function getOutclawPiExtensionBundleDigestPath(
	bundlePath: string,
): string {
	return `${bundlePath}.sha256`;
}

export function createOutclawPiExtensionBundleBanner(
	extensionSourceDir: string,
	repoRoot = resolveRepoRootFromPiExtensionSourceDir(extensionSourceDir),
): string {
	return `${OUTCLAW_PI_EXTENSION_FINGERPRINT_PREFIX}${calculateOutclawPiExtensionFingerprint(extensionSourceDir, repoRoot)}\n`;
}

export function isOutclawPiExtensionBundleCurrent(
	bundlePath: string,
	extensionSourceDir: string,
	repoRoot = resolveRepoRootFromPiExtensionSourceDir(extensionSourceDir),
): boolean {
	if (!existsSync(bundlePath)) return false;
	const output = readFileSync(bundlePath, "utf8");
	const firstLine = output.split(/\r?\n/, 1)[0] ?? "";
	return (
		firstLine ===
			createOutclawPiExtensionBundleBanner(
				extensionSourceDir,
				repoRoot,
			).trimEnd() &&
		isValidOutclawPiExtensionBundle(output) &&
		hasMatchingOutclawPiExtensionBundleDigest(bundlePath, output)
	);
}

export function writeOutclawPiExtensionBundleDigest(bundlePath: string): void {
	writeFileSync(
		getOutclawPiExtensionBundleDigestPath(bundlePath),
		`${createOutclawPiExtensionBundleDigest(readFileSync(bundlePath, "utf8"))}\n`,
	);
}

export function isValidOutclawPiExtensionBundle(output: string): boolean {
	return REQUIRED_BUNDLE_TEXT.every((text) => output.includes(text));
}

function calculateOutclawPiExtensionFingerprint(
	extensionSourceDir: string,
	repoRoot: string,
): string {
	const hash = createHash("sha256");
	for (const file of EXTENSION_SOURCE_FILES) {
		addFileToHash(hash, join(extensionSourceDir, file));
	}
	for (const file of REPO_FINGERPRINT_FILES) {
		addFileToHash(hash, join(repoRoot, file));
	}
	return hash.digest("hex");
}

function hasMatchingOutclawPiExtensionBundleDigest(
	bundlePath: string,
	output: string,
): boolean {
	const digestPath = getOutclawPiExtensionBundleDigestPath(bundlePath);
	if (!existsSync(digestPath)) return false;
	return (
		readFileSync(digestPath, "utf8").trim() ===
		createOutclawPiExtensionBundleDigest(output)
	);
}

function createOutclawPiExtensionBundleDigest(output: string): string {
	return createHash("sha256").update(output).digest("hex");
}

function addFileToHash(
	hash: ReturnType<typeof createHash>,
	path: string,
): void {
	if (!existsSync(path)) return;
	hash.update(path);
	hash.update("\0");
	hash.update(readFileSync(path));
	hash.update("\0");
}
