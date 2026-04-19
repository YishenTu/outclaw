import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageMediaType, ImageRef } from "../../common/protocol.ts";

export async function saveManagedImage(
	filesRoot: string,
	mediaType: ImageMediaType,
	bytes: Uint8Array,
): Promise<ImageRef> {
	const now = new Date();
	const year = now.getFullYear().toString().padStart(4, "0");
	const month = `${now.getMonth() + 1}`.padStart(2, "0");
	const day = `${now.getDate()}`.padStart(2, "0");
	const directory = join(filesRoot, "images", year, month, day);
	await mkdir(directory, { recursive: true });

	const path = join(
		directory,
		`${randomUUID().slice(0, 8)}${extensionForImageMediaType(mediaType)}`,
	);
	await writeFile(path, bytes);

	return {
		path,
		mediaType,
	};
}

function extensionForImageMediaType(mediaType: ImageMediaType): string {
	switch (mediaType) {
		case "image/jpeg":
			return ".jpg";
		case "image/png":
			return ".png";
		case "image/gif":
			return ".gif";
		case "image/webp":
			return ".webp";
	}
}
