import type { SimNode } from "./graph-merge.ts";

const NODE_BASE_RADIUS = 3;
const NODE_DEGREE_RADIUS_STEP = 0.6;
const NODE_MAX_RADIUS = 12;

export function computeNodeRadius(degree: number): number {
	return Math.min(
		NODE_MAX_RADIUS,
		NODE_BASE_RADIUS + Math.sqrt(degree) * NODE_DEGREE_RADIUS_STEP * 2,
	);
}

export interface FitTransformOptions {
	transformRef: React.MutableRefObject<{
		scale: number;
		translateX: number;
		translateY: number;
	}>;
	sizeRef: React.MutableRefObject<{ width: number; height: number }>;
	nodes: SimNode[];
	padding: number;
}

/**
 * Fit the graph into the viewport by anchoring the mean (centroid) of node
 * positions at the viewport center, and choosing a scale that keeps every
 * node's farthest extent on each axis within half the viewport.
 *
 * This is preferred over bbox-center because d3's `forceCenter` already
 * optimizes for the mean position. When the graph is asymmetric (more leaves
 * on one side, an outlier dragging one axis), bbox-center fitting would shift
 * the visual mass off-center; centroid fitting keeps it where the eye
 * naturally lands. Asymmetric content shows up as extra whitespace on the
 * lighter side rather than a misaligned cluster.
 */
export function fitTransform(opts: FitTransformOptions): void {
	const { transformRef, sizeRef, nodes, padding } = opts;
	let meanX = 0;
	let meanY = 0;
	let count = 0;
	for (const node of nodes) {
		if (node.x === undefined || node.y === undefined) {
			continue;
		}
		meanX += node.x;
		meanY += node.y;
		count += 1;
	}
	if (count === 0) {
		return;
	}
	meanX /= count;
	meanY /= count;

	// Worst-case half-extent from the mean on each axis. Any node's outer edge
	// (center ± radius) farther from the mean wins.
	let extentX = 0;
	let extentY = 0;
	for (const node of nodes) {
		if (node.x === undefined || node.y === undefined) {
			continue;
		}
		const radius = computeNodeRadius(node.degree);
		extentX = Math.max(extentX, Math.abs(node.x - meanX) + radius);
		extentY = Math.max(extentY, Math.abs(node.y - meanY) + radius);
	}
	if (extentX === 0 && extentY === 0) {
		return;
	}

	const { width, height } = sizeRef.current;
	if (width <= 0 || height <= 0) {
		return;
	}
	const halfWidth = Math.max(1, width / 2 - padding);
	const halfHeight = Math.max(1, height / 2 - padding);
	const scaleX = halfWidth / Math.max(1, extentX);
	const scaleY = halfHeight / Math.max(1, extentY);
	const nextScale = Math.min(2, Math.max(0.4, Math.min(scaleX, scaleY)));

	transformRef.current = {
		scale: nextScale,
		translateX: width / 2 - meanX * nextScale,
		translateY: height / 2 - meanY * nextScale,
	};
}
