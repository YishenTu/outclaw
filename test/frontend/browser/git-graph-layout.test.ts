import { describe, expect, test } from "bun:test";
import {
	measureGitGraphCompactHeight,
	measureGitGraphExpandedHeight,
	measureGitGraphExpansionTop,
	measureGitGraphInfoOffset,
} from "../../../src/frontend/browser/components/right-panel/git-graph-layout.ts";

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

	test("places the expansion below the selected detail row", () => {
		const graphRoot = {
			getBoundingClientRect() {
				return { top: 120 } as DOMRect;
			},
		};
		const selectedDetail = {
			getBoundingClientRect() {
				return { bottom: 170.2 } as DOMRect;
			},
		};

		expect(measureGitGraphExpansionTop(graphRoot, selectedDetail)).toBe(59);
	});

	test("extends the graph height to fit the expanded commit card", () => {
		const expandedCard = {
			getBoundingClientRect() {
				return { height: 72.2 } as DOMRect;
			},
		};

		expect(measureGitGraphExpandedHeight(85, 130, expandedCard)).toBe(211);
	});

	test("pads the info column from the rendered svg width", () => {
		const svgRoot = {
			getBoundingClientRect() {
				return { width: 51.2 } as DOMRect;
			},
		};

		expect(measureGitGraphInfoOffset(svgRoot)).toBe(60);
	});

	test("keeps at least the gap when the svg has no measurable width", () => {
		const svgRoot = {
			getBoundingClientRect() {
				return { width: 0 } as DOMRect;
			},
		};

		expect(measureGitGraphInfoOffset(svgRoot)).toBe(8);
	});
});
