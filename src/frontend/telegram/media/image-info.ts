import { extname } from "node:path";
import type { ImageMediaType } from "../../../common/protocol.ts";

export function getImageInfo(path: string): {
	ext: string;
	mediaType: ImageMediaType;
} {
	const ext = extname(path).toLowerCase();
	switch (ext) {
		case ".jpg":
		case ".jpeg":
			return { ext, mediaType: "image/jpeg" };
		case ".png":
			return { ext, mediaType: "image/png" };
		case ".gif":
			return { ext, mediaType: "image/gif" };
		case ".webp":
			return { ext, mediaType: "image/webp" };
		default:
			throw new Error(`Unsupported Telegram image type: ${ext || "unknown"}`);
	}
}
