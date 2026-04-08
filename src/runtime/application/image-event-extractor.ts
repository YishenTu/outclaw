import { existsSync } from "node:fs";
import type { ImageEvent } from "../../common/protocol.ts";

const IMAGE_PATH_PATTERN = /\/[^\s"'`<>|]+?\.(?:png|jpe?g|gif|webp)\b/gi;

export function extractImageEventsFromText(
	text: string,
	emittedPaths: Set<string>,
): ImageEvent[] {
	const imageEvents: ImageEvent[] = [];

	for (const match of text.matchAll(IMAGE_PATH_PATTERN)) {
		const path = match[0];
		if (emittedPaths.has(path) || !existsSync(path)) {
			continue;
		}
		emittedPaths.add(path);
		imageEvents.push({
			type: "image",
			path,
		});
	}

	return imageEvents;
}

export class RuntimeImageEventExtractor {
	private emittedPaths = new Set<string>();
	private textBuffer = "";

	extract(text: string): ImageEvent[] {
		this.textBuffer += text;
		return extractImageEventsFromText(this.textBuffer, this.emittedPaths);
	}
}
