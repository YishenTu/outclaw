import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { BrowserFileResponse } from "../../../common/protocol.ts";
import { readBrowserFile } from "./read-browser-file.ts";

export class FileConflictError extends Error {
	readonly current: BrowserFileResponse;

	constructor(current: BrowserFileResponse) {
		super("File changed on disk");
		this.current = current;
		this.name = "FileConflictError";
	}
}

export async function writeBrowserFile(
	rootDir: string,
	absolutePath: string,
	content: string,
	expected: { mtimeMs: number; sha256: string },
): Promise<BrowserFileResponse> {
	assertInsideRoot(rootDir, absolutePath);

	const info = await stat(absolutePath);
	if (!info.isFile()) {
		throw new Error("Path does not reference a file");
	}

	const currentBuffer = await readFile(absolutePath);
	const currentSha256 = hashBuffer(currentBuffer);
	if (info.mtimeMs !== expected.mtimeMs || currentSha256 !== expected.sha256) {
		throw new FileConflictError(await readBrowserFile(rootDir, absolutePath));
	}

	const tempPath = `${absolutePath}.tmp.${randomUUID()}`;
	try {
		await writeFile(tempPath, content, "utf8");
		await rename(tempPath, absolutePath);
	} catch (error) {
		await unlink(tempPath).catch(() => undefined);
		throw error;
	}

	return await readBrowserFile(rootDir, absolutePath);
}

function assertInsideRoot(rootDir: string, absolutePath: string) {
	const resolvedRoot = resolve(rootDir);
	const resolvedPath = resolve(absolutePath);
	if (
		resolvedPath !== resolvedRoot &&
		!resolvedPath.startsWith(`${resolvedRoot}${sep}`)
	) {
		throw new Error("Path escapes agent home");
	}
}

function hashBuffer(buffer: Uint8Array): string {
	return createHash("sha256").update(buffer).digest("hex");
}
