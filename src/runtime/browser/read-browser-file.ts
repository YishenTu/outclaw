import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import type { BrowserFileResponse } from "../../common/protocol.ts";
import { detectFileLanguage } from "./detect-file-language.ts";

const MAX_FILE_PREVIEW_BYTES = 512 * 1024;

export async function readBrowserFile(
	rootDir: string,
	absolutePath: string,
): Promise<BrowserFileResponse> {
	const info = await stat(absolutePath);
	if (!info.isFile()) {
		throw new Error("Path does not reference a file");
	}

	const fileBuffer = await readFile(absolutePath);
	const truncated = fileBuffer.byteLength > MAX_FILE_PREVIEW_BYTES;
	const previewBuffer = truncated
		? fileBuffer.subarray(0, MAX_FILE_PREVIEW_BYTES)
		: fileBuffer;
	const path = toRelativePath(rootDir, absolutePath);
	if (looksBinary(previewBuffer)) {
		return {
			path,
			kind: "binary",
			language: detectFileLanguage(path),
			truncated,
		};
	}

	return {
		path,
		kind: "text",
		content: new TextDecoder().decode(previewBuffer),
		language: detectFileLanguage(path),
		truncated,
	};
}

function toRelativePath(rootDir: string, absolutePath: string): string {
	return relative(rootDir, absolutePath).split("\\").join("/");
}

function looksBinary(buffer: Uint8Array): boolean {
	const sampleSize = Math.min(buffer.byteLength, 1024);
	for (let index = 0; index < sampleSize; index += 1) {
		if (buffer[index] === 0) {
			return true;
		}
	}
	return false;
}
