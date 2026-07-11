import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	BROWSER_ENTRY_CHUNK_BUDGET_KIB,
	BROWSER_INITIAL_SCRIPT_BUDGET_KIB,
} from "../src/frontend/browser/build/build-config.ts";

const distDir = join(import.meta.dir, "../src/frontend/browser/dist");
const assetsDir = join(distDir, "assets");
const entryChunks = readdirSync(assetsDir).filter((name) =>
	/^index-.*\.js$/.test(name),
);
if (entryChunks.length !== 1) {
	throw new Error(
		`Expected one browser entry chunk, found ${entryChunks.length}`,
	);
}
const entryChunk = entryChunks[0];
if (!entryChunk) {
	throw new Error("Browser entry chunk is missing");
}
const sizeKib = statSync(join(assetsDir, entryChunk)).size / 1024;
if (sizeKib > BROWSER_ENTRY_CHUNK_BUDGET_KIB) {
	throw new Error(
		`Browser entry chunk is ${sizeKib.toFixed(1)} KiB, above ${BROWSER_ENTRY_CHUNK_BUDGET_KIB} KiB`,
	);
}
console.log(
	`Browser entry chunk: ${sizeKib.toFixed(1)} KiB / ${BROWSER_ENTRY_CHUNK_BUDGET_KIB} KiB`,
);

const indexHtml = readFileSync(join(distDir, "index.html"), "utf8");
const initialScriptPaths = [
	...indexHtml.matchAll(
		/<(?:script[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="([^"]+\.js)"/g,
	),
].map((match) => match[1]);
const uniqueInitialScriptPaths = [...new Set(initialScriptPaths)];
if (uniqueInitialScriptPaths.length === 0) {
	throw new Error("Browser initial script graph is missing");
}
const initialScriptSizeKib = uniqueInitialScriptPaths.reduce((total, path) => {
	if (!path) {
		return total;
	}
	return total + statSync(join(distDir, path.replace(/^\//, ""))).size / 1024;
}, 0);
if (initialScriptSizeKib > BROWSER_INITIAL_SCRIPT_BUDGET_KIB) {
	throw new Error(
		`Browser initial scripts are ${initialScriptSizeKib.toFixed(1)} KiB, above ${BROWSER_INITIAL_SCRIPT_BUDGET_KIB} KiB`,
	);
}
console.log(
	`Browser initial scripts: ${initialScriptSizeKib.toFixed(1)} KiB / ${BROWSER_INITIAL_SCRIPT_BUDGET_KIB} KiB`,
);
