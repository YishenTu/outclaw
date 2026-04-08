import { existsSync } from "node:fs";
import type { ImageEvent } from "../common/protocol.ts";

const IMAGE_PATH_PATTERN = /\/[^\s"'`<>|]+?\.(?:png|jpe?g|gif|webp)\b/gi;

export function extractImageEvents(
	value: unknown,
	emittedPaths: Set<string>,
): ImageEvent[] {
	const imageEvents: ImageEvent[] = [];

	for (const text of collectStrings(value)) {
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
	}

	return imageEvents;
}

function collectStrings(value: unknown, seen = new Set<unknown>()): string[] {
	if (typeof value === "string") {
		return [value];
	}

	if (!value || typeof value !== "object" || seen.has(value)) {
		return [];
	}

	seen.add(value);

	if (Array.isArray(value)) {
		return value.flatMap((item) => collectStrings(item, seen));
	}

	return Object.values(value).flatMap((item) => collectStrings(item, seen));
}
