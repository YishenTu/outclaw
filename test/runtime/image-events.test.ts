import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractImageEvents } from "../../src/runtime/image-events.ts";

describe("extractImageEvents", () => {
	const tmp = mkdtempSync(join(tmpdir(), "mis-imgev-"));

	function touch(name: string): string {
		const p = join(tmp, name);
		writeFileSync(p, "bytes");
		return p;
	}

	test("extracts paths for existing image files", () => {
		const png = touch("chart.png");
		const events = extractImageEvents(`See ${png} for details`, new Set());
		expect(events).toEqual([{ type: "image", path: png }]);
	});

	test("extracts multiple image paths from one string", () => {
		const a = touch("a.jpg");
		const b = touch("b.webp");
		const events = extractImageEvents(`${a} and ${b}`, new Set());
		expect(events).toHaveLength(2);
		expect(events.map((e) => e.path)).toEqual([a, b]);
	});

	test("skips paths that do not exist on disk", () => {
		const events = extractImageEvents("/nonexistent/fake.png", new Set());
		expect(events).toHaveLength(0);
	});

	test("deduplicates already-emitted paths", () => {
		const png = touch("dup.png");
		const emitted = new Set<string>();
		extractImageEvents(`first ${png}`, emitted);
		const second = extractImageEvents(`again ${png}`, emitted);
		expect(second).toHaveLength(0);
	});

	test("deduplicates within a single call", () => {
		const png = touch("same.png");
		const events = extractImageEvents(`${png} then ${png}`, new Set());
		expect(events).toHaveLength(1);
	});

	test("handles nested objects and arrays", () => {
		const png = touch("nested.png");
		const value = {
			messages: [{ content: [{ text: `Saved to ${png}` }] }],
		};
		const events = extractImageEvents(value, new Set());
		expect(events).toEqual([{ type: "image", path: png }]);
	});

	test("handles non-object values gracefully", () => {
		expect(extractImageEvents(null, new Set())).toEqual([]);
		expect(extractImageEvents(undefined, new Set())).toEqual([]);
		expect(extractImageEvents(42, new Set())).toEqual([]);
	});

	test("matches supported extensions", () => {
		for (const ext of ["png", "jpg", "jpeg", "gif", "webp"]) {
			const p = touch(`test.${ext}`);
			const events = extractImageEvents(p, new Set());
			expect(events).toHaveLength(1);
		}
	});

	test("ignores non-image extensions", () => {
		const p = touch("doc.pdf");
		const events = extractImageEvents(p, new Set());
		expect(events).toHaveLength(0);
	});
});
