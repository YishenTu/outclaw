import { describe, expect, test } from "bun:test";
import { getImageThumbnailClassName } from "../../../src/frontend/browser/components/chat/image-thumbnail-styles.ts";

describe("browser image thumbnail styles", () => {
	test("composer thumbnails preserve aspect ratio instead of forcing a square", () => {
		const className = getImageThumbnailClassName("composer");

		expect(className).toContain("h-auto");
		expect(className).toContain("w-auto");
		expect(className).toContain("max-h-16");
		expect(className).toContain("max-w-[6rem]");
		expect(className).toContain("object-contain");
		expect(className).not.toContain("h-16 w-16");
	});

	test("message thumbnails preserve aspect ratio instead of forcing a square", () => {
		const className = getImageThumbnailClassName("message");

		expect(className).toContain("h-auto");
		expect(className).toContain("w-auto");
		expect(className).toContain("max-h-24");
		expect(className).toContain("max-w-[14rem]");
		expect(className).toContain("object-contain");
		expect(className).not.toContain("h-24 w-24");
	});
});
