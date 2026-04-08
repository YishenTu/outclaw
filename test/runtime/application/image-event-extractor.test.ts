import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	extractImageEventsFromText,
	RuntimeImageEventExtractor,
} from "../../../src/runtime/application/image-event-extractor.ts";

describe("extractImageEventsFromText", () => {
	const tmp = mkdtempSync(join(tmpdir(), "mis-imgev-"));

	function touch(name: string): string {
		const p = join(tmp, name);
		writeFileSync(p, "bytes");
		return p;
	}

	test("extracts paths for existing image files", () => {
		const png = touch("chart.png");
		const events = extractImageEventsFromText(
			`See ${png} for details`,
			new Set(),
		);
		expect(events).toEqual([{ type: "image", path: png }]);
	});

	test("extracts multiple image paths from one string", () => {
		const a = touch("a.jpg");
		const b = touch("b.webp");
		const events = extractImageEventsFromText(`${a} and ${b}`, new Set());
		expect(events).toHaveLength(2);
		expect(events.map((e) => e.path)).toEqual([a, b]);
	});

	test("skips paths that do not exist on disk", () => {
		const events = extractImageEventsFromText(
			"/nonexistent/fake.png",
			new Set(),
		);
		expect(events).toHaveLength(0);
	});

	test("deduplicates already-emitted paths", () => {
		const png = touch("dup.png");
		const emitted = new Set<string>();
		extractImageEventsFromText(`first ${png}`, emitted);
		const second = extractImageEventsFromText(`again ${png}`, emitted);
		expect(second).toHaveLength(0);
	});

	test("deduplicates within a single call", () => {
		const png = touch("same.png");
		const events = extractImageEventsFromText(`${png} then ${png}`, new Set());
		expect(events).toHaveLength(1);
	});

	test("handles empty text gracefully", () => {
		expect(extractImageEventsFromText("", new Set())).toEqual([]);
	});

	test("matches supported extensions", () => {
		for (const ext of ["png", "jpg", "jpeg", "gif", "webp"]) {
			const p = touch(`test.${ext}`);
			const events = extractImageEventsFromText(p, new Set());
			expect(events).toHaveLength(1);
		}
	});

	test("ignores non-image extensions", () => {
		const p = touch("doc.pdf");
		const events = extractImageEventsFromText(p, new Set());
		expect(events).toHaveLength(0);
	});
});

describe("RuntimeImageEventExtractor", () => {
	const tmp = mkdtempSync(join(tmpdir(), "mis-runtime-imgev-"));

	function touch(name: string): string {
		const p = join(tmp, name);
		writeFileSync(p, "bytes");
		return p;
	}

	test("extracts image events across text chunks", () => {
		const png = touch("chunked.png");
		const extractor = new RuntimeImageEventExtractor();

		expect(extractor.extract(`Saved chart to ${png.slice(0, 8)}`)).toEqual([]);
		expect(extractor.extract(png.slice(8))).toEqual([
			{ type: "image", path: png },
		]);
	});

	test("does not emit the same path twice across chunks", () => {
		const png = touch("repeat.png");
		const extractor = new RuntimeImageEventExtractor();

		expect(extractor.extract(`See ${png}`)).toEqual([
			{ type: "image", path: png },
		]);
		expect(extractor.extract(` again ${png}`)).toEqual([]);
	});
});
