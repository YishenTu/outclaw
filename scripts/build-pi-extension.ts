import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
	createOutclawPiExtensionBundleBanner,
	isValidOutclawPiExtensionBundle,
	OUTCLAW_PI_EXTENSION_SOURCE_FILE,
} from "../src/backend/adapters/pi/extension-bundle.ts";

const repoRoot = join(dirname(import.meta.dir), ".");
const extensionSourceDir = join(repoRoot, "src/backend/adapters/pi/extensions");
const entryPoint = join(extensionSourceDir, OUTCLAW_PI_EXTENSION_SOURCE_FILE);
const outputFile = readOutputFileArg(process.argv);
const checkMode = process.argv.includes("--check");
const tempDir = outputFile
	? undefined
	: mkdtempSync(join(tmpdir(), "outclaw-pi-"));
const targetFile = outputFile ?? join(tempDir ?? tmpdir(), "outclaw-index.js");

try {
	if (!existsSync(entryPoint)) {
		throw new Error(`Pi extension source does not exist: ${entryPoint}`);
	}

	mkdirSync(dirname(targetFile), { recursive: true });
	await build({
		entryPoints: [entryPoint],
		outfile: targetFile,
		bundle: true,
		format: "esm",
		platform: "node",
		target: "node20",
		minify: true,
		sourcemap: false,
		legalComments: "none",
		logLevel: "silent",
		banner: {
			js: createOutclawPiExtensionBundleBanner(extensionSourceDir, repoRoot),
		},
	});

	const output = readFileSync(targetFile, "utf8");
	validateGeneratedOutclawExtension(output);

	const imported = await import(
		`${pathToFileURL(targetFile).href}?t=${Date.now()}`
	);
	if (typeof imported.default !== "function") {
		throw new Error(
			"Generated Pi extension does not export a default function",
		);
	}

	console.log(
		checkMode || !outputFile ? `Checked ${targetFile}` : `Built ${targetFile}`,
	);
} finally {
	if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}

function validateGeneratedOutclawExtension(output: string): void {
	if (!isValidOutclawPiExtensionBundle(output)) {
		throw new Error(
			"Generated Pi extension is missing required Outclaw tool registrations",
		);
	}
	if (output.includes("web_context")) {
		throw new Error("Generated Pi extension still contains web_context");
	}
}

function readOutputFileArg(argv: string[]): string | undefined {
	const index = argv.indexOf("--out");
	if (index < 0) return undefined;
	const outputFile = argv[index + 1];
	if (!outputFile || outputFile.startsWith("--")) {
		throw new Error("Missing output path after --out");
	}
	return outputFile;
}
