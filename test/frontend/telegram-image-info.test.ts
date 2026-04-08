import { describe, expect, test } from "bun:test";
import { getImageInfo } from "../../src/frontend/telegram/image-info.ts";

describe("getImageInfo", () => {
	test("maps .png to image/png", () => {
		expect(getImageInfo("/tmp/chart.png")).toEqual({
			ext: ".png",
			mediaType: "image/png",
		});
	});

	test("maps .jpg to image/jpeg", () => {
		expect(getImageInfo("/tmp/photo.jpg")).toEqual({
			ext: ".jpg",
			mediaType: "image/jpeg",
		});
	});

	test("maps .jpeg to image/jpeg", () => {
		expect(getImageInfo("/tmp/photo.jpeg")).toEqual({
			ext: ".jpeg",
			mediaType: "image/jpeg",
		});
	});

	test("maps .gif to image/gif", () => {
		expect(getImageInfo("/tmp/anim.gif")).toEqual({
			ext: ".gif",
			mediaType: "image/gif",
		});
	});

	test("maps .webp to image/webp", () => {
		expect(getImageInfo("/tmp/photo.webp")).toEqual({
			ext: ".webp",
			mediaType: "image/webp",
		});
	});

	test("is case-insensitive", () => {
		expect(getImageInfo("/tmp/PHOTO.PNG")).toEqual({
			ext: ".png",
			mediaType: "image/png",
		});
	});

	test("throws for unsupported extension", () => {
		expect(() => getImageInfo("/tmp/doc.pdf")).toThrow(
			"Unsupported Telegram image type: .pdf",
		);
	});

	test("throws for file with no extension", () => {
		expect(() => getImageInfo("/tmp/noext")).toThrow(
			"Unsupported Telegram image type: unknown",
		);
	});
});
