import { describe, expect, test } from "bun:test";
import {
	createComposerImageAttachment,
	filterSupportedImageFiles,
} from "../../../src/frontend/browser/components/chat/composer/composer-images.ts";

describe("browser composer images", () => {
	test("filters to supported image files only", () => {
		const files = [
			new File(["png"], "cat.png", { type: "image/png" }),
			new File(["txt"], "notes.txt", { type: "text/plain" }),
			new File(["jpg"], "dog.jpg", { type: "image/jpeg" }),
		];

		expect(filterSupportedImageFiles(files).map((file) => file.name)).toEqual([
			"cat.png",
			"dog.jpg",
		]);
	});

	test("creates inline display images for browser previews", async () => {
		const attachment = await createComposerImageAttachment(
			new File(["png-bytes"], "cat.png", { type: "image/png" }),
		);

		expect(attachment.file.name).toBe("cat.png");
		expect(attachment.image).toEqual({
			kind: "inline",
			mediaType: "image/png",
			base64: Buffer.from("png-bytes").toString("base64"),
		});
	});
});
