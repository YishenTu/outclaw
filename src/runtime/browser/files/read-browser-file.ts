import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import type { BrowserFileResponse } from "../../../common/protocol.ts";
import { detectFileLanguage } from "./detect-file-language.ts";

export async function readBrowserFile(
	rootDir: string,
	absolutePath: string,
): Promise<BrowserFileResponse> {
	const info = await stat(absolutePath);
	if (!info.isFile()) {
		throw new Error("Path does not reference a file");
	}

	const fileBuffer = await readFile(absolutePath);
	const path = toRelativePath(rootDir, absolutePath);
	if (looksBinary(fileBuffer)) {
		return {
			path,
			kind: "binary",
			language: detectFileLanguage(path),
			truncated: false,
		};
	}

	return {
		path,
		kind: "text",
		content: new TextDecoder().decode(fileBuffer),
		language: detectFileLanguage(path),
		truncated: false,
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
