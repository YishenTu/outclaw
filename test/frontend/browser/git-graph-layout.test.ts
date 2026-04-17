import { describe, expect, test } from "bun:test";
import { measureGitGraphCompactHeight } from "../../../src/frontend/browser/components/right-panel/git-graph-layout.ts";

describe("measureGitGraphCompactHeight", () => {
	test("uses rendered geometry so translated detail rows stay visible", () => {
		const graphRoot = {
			getBoundingClientRect() {
				return { top: 120 } as DOMRect;
			},
		};
		const lastDetail = {
			getBoundingClientRect() {
				return { bottom: 196.25 } as DOMRect;
			},
		};

		expect(measureGitGraphCompactHeight(graphRoot, lastDetail)).toBe(85);
	});

	test("clamps negative heights to zero", () => {
		const graphRoot = {
			getBoundingClientRect() {
				return { top: 200 } as DOMRect;
			},
		};
		const lastDetail = {
			getBoundingClientRect() {
				return { bottom: 180 } as DOMRect;
			},
		};

		expect(measureGitGraphCompactHeight(graphRoot, lastDetail)).toBe(0);
	});
});
