import { existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export interface BrowserApp {
	distDir: string;
}

const INDEX_FILENAME = "index.html";
const BROWSER_BUILD_COMMAND = "oc build && oc restart";

export function serveBrowserApp(
	method: string,
	pathname: string,
	browserApp?: BrowserApp,
): Response | undefined {
	if (!browserApp) {
		return undefined;
	}

	if (method !== "GET" && method !== "HEAD") {
		return new Response("Method not allowed", { status: 405 });
	}

	const decodedPathname = decodePathname(pathname);
	if (decodedPathname === undefined) {
		return new Response("Not found", { status: 404 });
	}

	if (decodedPathname === "/") {
		return serveIndex(browserApp.distDir);
	}

	const filePath = resolveWithinRoot(browserApp.distDir, decodedPathname);
	if (filePath && isFile(filePath)) {
		return serveFile(method, filePath);
	}

	if (looksLikeAssetPath(decodedPathname)) {
		return new Response("Not found", { status: 404 });
	}

	return serveIndex(browserApp.distDir);
}

function decodePathname(pathname: string): string | undefined {
	try {
		return decodeURIComponent(pathname);
	} catch {
		return undefined;
	}
}

function resolveWithinRoot(
	rootDir: string,
	pathname: string,
): string | undefined {
	const candidate = resolve(rootDir, `.${pathname}`);
	const relativePath = relative(rootDir, candidate);
	if (
		relativePath === "" ||
		relativePath.startsWith("..") ||
		isAbsolute(relativePath)
	) {
		return undefined;
	}
	return candidate;
}

function isFile(path: string): boolean {
	return existsSync(path) && statSync(path).isFile();
}

function looksLikeAssetPath(pathname: string): boolean {
	const lastSlashIndex = pathname.lastIndexOf("/");
	const lastSegment =
		lastSlashIndex === -1 ? pathname : pathname.slice(lastSlashIndex + 1);
	return lastSegment.includes(".");
}

function serveIndex(distDir: string): Response {
	const indexPath = resolve(distDir, INDEX_FILENAME);
	if (!isFile(indexPath)) {
		return new Response(
			`Browser frontend is not built. Run \`${BROWSER_BUILD_COMMAND}\`.`,
			{ status: 503 },
		);
	}

	return serveFile("GET", indexPath, {
		"cache-control": "no-cache",
	});
}

function serveFile(
	method: string,
	path: string,
	extraHeaders?: Record<string, string>,
): Response {
	const file = Bun.file(path);
	const headers = new Headers(extraHeaders);
	if (file.type) {
		headers.set("content-type", file.type);
	}
	if (method === "HEAD") {
		return new Response(undefined, {
			headers,
			status: 200,
		});
	}
	return new Response(file, {
		headers,
		status: 200,
	});
}
