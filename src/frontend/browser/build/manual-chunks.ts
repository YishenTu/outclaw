const REACT_PACKAGES = new Set([
	"clsx",
	"lucide-react",
	"react",
	"react-dom",
	"scheduler",
	"zustand",
]);

const MARKDOWN_PACKAGES = new Set([
	"highlight.js",
	"lowlight",
	"react-markdown",
	"rehype-highlight",
	"remark-gfm",
]);

const MATH_PACKAGES = new Set(["katex", "rehype-katex", "remark-math"]);

const TERMINAL_PACKAGES = new Set(["@xterm/addon-fit", "@xterm/xterm"]);

const GIT_PACKAGES = new Set(["commit-graph"]);

export function extractNodeModulePackageName(id: string): string | undefined {
	const normalized = id.replaceAll("\\", "/");
	const nodeModulesMarker = "/node_modules/";
	const markerIndex = normalized.lastIndexOf(nodeModulesMarker);
	if (markerIndex === -1) {
		return undefined;
	}

	const remainder = normalized.slice(markerIndex + nodeModulesMarker.length);
	const [scopeOrName, scopedName] = remainder.split("/");
	if (!scopeOrName) {
		return undefined;
	}

	if (scopeOrName.startsWith("@")) {
		return scopedName ? `${scopeOrName}/${scopedName}` : undefined;
	}

	return scopeOrName;
}

export function manualChunkForBrowserModule(id: string): string | undefined {
	const packageName = extractNodeModulePackageName(id);
	if (!packageName) {
		return undefined;
	}

	if (REACT_PACKAGES.has(packageName)) {
		return "vendor-react";
	}

	if (MARKDOWN_PACKAGES.has(packageName)) {
		return "vendor-markdown";
	}

	if (MATH_PACKAGES.has(packageName)) {
		return "vendor-math";
	}

	if (TERMINAL_PACKAGES.has(packageName)) {
		return "vendor-terminal";
	}

	if (GIT_PACKAGES.has(packageName)) {
		return "vendor-git";
	}

	return undefined;
}
