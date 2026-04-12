import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

export interface SavedFile {
	path: string;
}

export async function saveTelegramFile(
	filesRoot: string,
	url: string,
	ext: string,
): Promise<SavedFile> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download Telegram file: ${response.status}`);
	}

	return writeTelegramFile(
		filesRoot,
		ext,
		Buffer.from(await response.arrayBuffer()),
	);
}

export async function copyTelegramFile(
	filesRoot: string,
	sourcePath: string,
): Promise<SavedFile> {
	const resolvedSourcePath = resolve(sourcePath);
	if (isManagedTelegramFilePath(filesRoot, resolvedSourcePath)) {
		return { path: resolvedSourcePath };
	}

	return writeTelegramFile(
		filesRoot,
		extname(resolvedSourcePath),
		Buffer.from(await Bun.file(resolvedSourcePath).arrayBuffer()),
	);
}

function isManagedTelegramFilePath(filesRoot: string, path: string): boolean {
	const resolvedRoot = resolve(filesRoot);
	return path === resolvedRoot || path.startsWith(`${resolvedRoot}${sep}`);
}

async function writeTelegramFile(
	filesRoot: string,
	ext: string,
	bytes: Uint8Array,
): Promise<SavedFile> {
	const now = new Date();
	const year = now.getFullYear().toString().padStart(4, "0");
	const month = `${now.getMonth() + 1}`.padStart(2, "0");
	const day = `${now.getDate()}`.padStart(2, "0");
	const directory = join(filesRoot, year, month, day);
	await mkdir(directory, { recursive: true });

	const normalizedExt = ext ? (ext.startsWith(".") ? ext : `.${ext}`) : "";
	const path = join(directory, `${randomUUID().slice(0, 8)}${normalizedExt}`);
	await writeFile(path, bytes);

	return { path };
}
