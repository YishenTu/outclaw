import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import type {
	BrowserGraphLink,
	BrowserGraphResponse,
} from "../../../../../common/protocol.ts";

export interface SimNode extends SimulationNodeDatum {
	id: string;
	name: string;
	path: string | null;
	resolved: boolean;
	degree: number;
	birthAt?: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {}

export interface MergeResult {
	nodes: SimNode[];
	links: SimLink[];
	addedIds: Set<string>;
	removedIds: Set<string>;
}

const NEW_NODE_JITTER_PX = 30;

export function computeDegrees(
	graph: BrowserGraphResponse,
): Map<string, number> {
	const degreeById = new Map<string, number>();
	for (const link of graph.links) {
		degreeById.set(link.source, (degreeById.get(link.source) ?? 0) + 1);
		degreeById.set(link.target, (degreeById.get(link.target) ?? 0) + 1);
	}
	return degreeById;
}

export function buildInitialSimData(graph: BrowserGraphResponse): {
	nodes: SimNode[];
	links: SimLink[];
} {
	const degreeById = computeDegrees(graph);
	const nodes: SimNode[] = graph.nodes.map((node) => ({
		id: node.id,
		name: node.name,
		path: node.path,
		resolved: node.resolved,
		degree: degreeById.get(node.id) ?? 0,
	}));
	const ids = new Set(nodes.map((node) => node.id));
	const links: SimLink[] = graph.links
		.filter((link) => ids.has(link.source) && ids.has(link.target))
		.map((link: BrowserGraphLink) => ({
			source: link.source,
			target: link.target,
		}));
	return { nodes, links };
}

/**
 * Build the next nodes/links arrays while preserving the *identity* and
 * positions of nodes that survived. New nodes are spawned near their connected
 * neighbors so the user sees them "born" attached to the existing cluster
 * rather than parachuting in from the origin.
 *
 * MUTATION CONTRACT — by design this function MUTATES the surviving SimNode
 * objects in place (refreshing name/path/resolved/degree). d3-force keeps
 * references to these node objects and reads their x/y/vx/vy on every tick;
 * replacing them with copies would break position continuity. Callers should
 * therefore not rely on `currentNodes` being unchanged after a merge call.
 */
export function mergeSimData(
	currentNodes: SimNode[],
	next: BrowserGraphResponse,
	options: { now?: number; jitter?: () => number } = {},
): MergeResult {
	const now = options.now ?? performance.now();
	const jitter = options.jitter ?? (() => Math.random() - 0.5);
	const degreeById = computeDegrees(next);
	const oldById = new Map(currentNodes.map((node) => [node.id, node]));
	const survivingById = new Map<string, SimNode>();
	const addedIds = new Set<string>();

	// Centroid of current nodes — fallback spawn point for nodes with no
	// resolved peers yet.
	let cx = 0;
	let cy = 0;
	let centroidCount = 0;
	for (const node of currentNodes) {
		if (typeof node.x === "number" && typeof node.y === "number") {
			cx += node.x;
			cy += node.y;
			centroidCount += 1;
		}
	}
	if (centroidCount > 0) {
		cx /= centroidCount;
		cy /= centroidCount;
	}

	const nodes: SimNode[] = next.nodes.map((node) => {
		const existing = oldById.get(node.id);
		if (existing) {
			existing.name = node.name;
			existing.path = node.path;
			existing.resolved = node.resolved;
			existing.degree = degreeById.get(node.id) ?? 0;
			survivingById.set(node.id, existing);
			return existing;
		}
		addedIds.add(node.id);
		return {
			id: node.id,
			name: node.name,
			path: node.path,
			resolved: node.resolved,
			degree: degreeById.get(node.id) ?? 0,
			birthAt: now,
		};
	});

	// Place each newly-added node near the centroid of its already-living
	// neighbors. d3's link force will pull it into a stable spot from there.
	for (const node of nodes) {
		if (!addedIds.has(node.id)) {
			continue;
		}
		let sumX = 0;
		let sumY = 0;
		let peerCount = 0;
		for (const link of next.links) {
			let peerId: string | null = null;
			if (link.source === node.id) {
				peerId = link.target;
			} else if (link.target === node.id) {
				peerId = link.source;
			}
			if (!peerId) {
				continue;
			}
			const peer = survivingById.get(peerId);
			if (peer && typeof peer.x === "number" && typeof peer.y === "number") {
				sumX += peer.x;
				sumY += peer.y;
				peerCount += 1;
			}
		}
		const baseX = peerCount > 0 ? sumX / peerCount : cx;
		const baseY = peerCount > 0 ? sumY / peerCount : cy;
		node.x = baseX + jitter() * NEW_NODE_JITTER_PX;
		node.y = baseY + jitter() * NEW_NODE_JITTER_PX;
		node.vx = 0;
		node.vy = 0;
	}

	const ids = new Set(nodes.map((node) => node.id));
	const removedIds = new Set<string>();
	for (const id of oldById.keys()) {
		if (!ids.has(id)) {
			removedIds.add(id);
		}
	}
	const links: SimLink[] = next.links
		.filter((link) => ids.has(link.source) && ids.has(link.target))
		.map((link: BrowserGraphLink) => ({
			source: link.source,
			target: link.target,
		}));

	return { nodes, links, addedIds, removedIds };
}
