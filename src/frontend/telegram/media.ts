import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { ImageMediaType, ImageRef } from "../../common/protocol.ts";

export async function saveTelegramMedia(
	mediaRoot: string,
	url: string,
	ext: string,
	mediaType: ImageMediaType,
): Promise<ImageRef> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download Telegram media: ${response.status}`);
	}

	return writeTelegramMedia(
		mediaRoot,
		ext,
		mediaType,
		Buffer.from(await response.arrayBuffer()),
	);
}

export async function copyTelegramMedia(
	mediaRoot: string,
	sourcePath: string,
	mediaType: ImageMediaType,
): Promise<ImageRef> {
	const resolvedSourcePath = resolve(sourcePath);
	if (isManagedTelegramMediaPath(mediaRoot, resolvedSourcePath)) {
		return {
			path: resolvedSourcePath,
			mediaType,
		};
	}

	return writeTelegramMedia(
		mediaRoot,
		extname(resolvedSourcePath),
		mediaType,
		Buffer.from(await Bun.file(resolvedSourcePath).arrayBuffer()),
	);
}

function isManagedTelegramMediaPath(mediaRoot: string, path: string): boolean {
	const resolvedRoot = resolve(mediaRoot);
	return path === resolvedRoot || path.startsWith(`${resolvedRoot}${sep}`);
}

async function writeTelegramMedia(
	mediaRoot: string,
	ext: string,
	mediaType: ImageMediaType,
	bytes: Uint8Array,
): Promise<ImageRef> {
	const now = new Date();
	const year = now.getFullYear().toString().padStart(4, "0");
	const month = `${now.getMonth() + 1}`.padStart(2, "0");
	const day = `${now.getDate()}`.padStart(2, "0");
	const directory = join(mediaRoot, year, month, day);
	await mkdir(directory, { recursive: true });

	const normalizedExt = ext.startsWith(".") ? ext : `.${ext}`;
	const path = join(directory, `${randomUUID().slice(0, 8)}${normalizedExt}`);
	await writeFile(path, bytes);

	return {
		path,
		mediaType,
	};
}
