import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import type { BrowserFileResponse } from "../../../common/protocol.ts";
import { resolveExistingPathWithinRoot } from "../paths/path-safety.ts";
import { writeFileContentInPlace } from "./in-place-file-writer.ts";
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
	const resolvedPath = resolveExistingPathWithinRoot(rootDir, absolutePath);

	const file = await open(resolvedPath, "r+");
	try {
		const info = await file.stat();
		if (!info.isFile()) {
			throw new Error("Path does not reference a file");
		}

		const currentBuffer = await file.readFile();
		const currentSha256 = hashBuffer(currentBuffer);
		if (
			info.mtimeMs !== expected.mtimeMs ||
			currentSha256 !== expected.sha256
		) {
			throw new FileConflictError(await readBrowserFile(rootDir, absolutePath));
		}

		await writeFileContentInPlace(file, content, {
			restoreContent: currentBuffer,
		});
	} finally {
		await file.close();
	}

	return await readBrowserFile(rootDir, resolvedPath);
}

function hashBuffer(buffer: Uint8Array): string {
	return createHash("sha256").update(buffer).digest("hex");
}
