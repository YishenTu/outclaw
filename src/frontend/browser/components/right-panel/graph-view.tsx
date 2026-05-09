import {
	forceCenter,
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	forceX,
	forceY,
	type Simulation,
} from "d3-force";
import { Maximize2, Sliders, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowserGraphResponse } from "../../../../common/protocol.ts";
import { fetchAgentGraph } from "../../lib/api.ts";
import { ForcesPanel } from "./graph/forces-panel.tsx";
import { computeNodeRadius, fitTransform } from "./graph/graph-fit.ts";
import {
	DEFAULT_FORCES,
	type GraphForces,
	loadStoredForces,
	saveStoredForces,
} from "./graph/graph-forces.ts";
import {
	buildInitialSimData,
	mergeSimData,
	type SimLink,
	type SimNode,
} from "./graph/graph-merge.ts";
import {
	COLOR_EDGE_FADED,
	COLOR_EDGE_HIGHLIGHT,
	COLOR_EDGE_IDLE,
	COLOR_HALO_RGB,
	COLOR_LABEL_RGB,
	COLOR_NODE_RESOLVED_HOVER,
	COLOR_NODE_RESOLVED_IDLE,
	COLOR_NODE_UNRESOLVED,
} from "./graph/graph-palette.ts";

interface GraphViewProps {
	agentId: string;
	treeRevision: number;
	/**
	 * Whether the graph view is currently the visible pane. When false, the
	 * parent typically wraps this component in a `display: none` container,
	 * which makes `getBoundingClientRect()` report 0×0. The component still
	 * mounts and pre-builds the simulation, then performs the deferred fit the
	 * moment this prop flips to true. Default true so the prop stays optional
	 * for callers that always show the graph.
	 */
	isVisible?: boolean;
	/**
	 * Path of the file currently active in the chat-side tab strip, if any.
	 * Matched against node ids; the matching node receives the same visual
	 * focus treatment as a hovered node so the user can spot their context
	 * without searching.
	 */
	activeFilePath?: string | null;
	onOpenFile: (params: { agentId: string; path: string }) => void;
}

const HOVER_RADIUS_PADDING = 4;
const POINTER_DRAG_THRESHOLD_PX = 4;
const FIT_PADDING_PX = 24;
const FIT_ALPHA_THRESHOLD = 0.08;
const PRETICK_MAX_ITERATIONS = 300;
const POSTPRETICK_ALPHA = 0.25;
const REFRESH_DEBOUNCE_MS = 350;
const MERGE_ALPHA = 0.4;
const NODE_BIRTH_HIGHLIGHT_MS = 1500;

// Below this zoom level, no permanent labels are drawn. Past it, labels fade
// in linearly until LABEL_FULL_OPACITY_SCALE.
const LABEL_VISIBILITY_MIN_SCALE = 1.3;
const LABEL_FULL_OPACITY_SCALE = 1.9;
const LABEL_BASE_ALPHA = 0.85;

type PointerState =
	| {
			mode: "node";
			node: SimNode;
			startClientX: number;
			startClientY: number;
			moved: boolean;
	  }
	| {
			mode: "pan";
			startClientX: number;
			startClientY: number;
			originTranslateX: number;
			originTranslateY: number;
			moved: boolean;
	  };

export function GraphView({
	agentId,
	treeRevision,
	isVisible = true,
	activeFilePath = null,
	onOpenFile,
}: GraphViewProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const simulationRef = useRef<Simulation<SimNode, SimLink> | null>(null);
	const simulationAgentRef = useRef<string | null>(null);
	const nodesRef = useRef<SimNode[]>([]);
	const linksRef = useRef<SimLink[]>([]);
	const transformRef = useRef({ scale: 1, translateX: 0, translateY: 0 });
	const hoveredIdRef = useRef<string | null>(null);
	const pointerStateRef = useRef<PointerState | null>(null);
	const sizeRef = useRef({ width: 0, height: 0 });
	const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
	const dprRef = useRef<number>(1);
	const renderRef = useRef<() => void>(() => {});
	// Tracks whether the current simulation has had its initial fit-to-view.
	// Reset on agent switch and on simulation rebuild. Used to defer fit when
	// the canvas is hidden (e.g., user is in the file tree pane) at first
	// build, then perform it the moment the canvas becomes visible.
	const didFitRef = useRef(false);

	const [graph, setGraph] = useState<BrowserGraphResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const [isPanning, setIsPanning] = useState(false);
	const [forces, setForces] = useState<GraphForces>(loadStoredForces);
	const [forcesPanelOpen, setForcesPanelOpen] = useState(false);
	const [layoutReady, setLayoutReady] = useState(false);
	const forcesRef = useRef<GraphForces>(forces);
	forcesRef.current = forces;
	const activeFilePathRef = useRef<string | null>(activeFilePath);
	activeFilePathRef.current = activeFilePath;

	// Fetcher: initial load + on every treeRevision bump (debounced).
	useEffect(() => {
		// treeRevision is the trigger; reading it here keeps biome happy and
		// makes the dependency intent explicit.
		void treeRevision;
		let cancelled = false;
		const isInitial = simulationAgentRef.current !== agentId;
		if (isInitial) {
			setLoading(true);
			setError(null);
		}

		const timeout = window.setTimeout(
			() => {
				fetchAgentGraph(agentId)
					.then((next) => {
						if (cancelled) {
							return;
						}
						setGraph(next);
						if (isInitial) {
							setError(null);
						}
					})
					.catch((err: unknown) => {
						if (cancelled) {
							return;
						}
						if (isInitial) {
							setError(
								err instanceof Error ? err.message : "Failed to load graph",
							);
						}
					})
					.finally(() => {
						if (cancelled) {
							return;
						}
						if (isInitial) {
							setLoading(false);
						}
					});
			},
			isInitial ? 0 : REFRESH_DEBOUNCE_MS,
		);

		return () => {
			cancelled = true;
			window.clearTimeout(timeout);
		};
	}, [agentId, treeRevision]);

	const simData = useMemo(
		() => (graph ? buildInitialSimData(graph) : null),
		[graph],
	);

	/**
	 * Synchronously settle the simulation around its current force centers,
	 * fit the camera to the resulting layout, then resume at low energy.
	 * Shared by ResizeObserver "real resize", Effect D's deferred-fit on
	 * visibility, and the manual fit button. Each caller is responsible for
	 * updating any forces (e.g., new center) BEFORE calling this — the helper
	 * only handles the settle/fit/restart cadence.
	 *
	 * No-op if the simulation isn't built yet.
	 */
	const resettleAndFit = useCallback(() => {
		const sim = simulationRef.current;
		if (!sim) {
			return;
		}
		sim.stop();
		for (let i = 0; i < PRETICK_MAX_ITERATIONS; i += 1) {
			sim.tick();
			if (sim.alpha() < FIT_ALPHA_THRESHOLD) {
				break;
			}
		}
		fitTransform({
			transformRef,
			sizeRef,
			nodes: nodesRef.current,
			padding: FIT_PADDING_PX,
		});
		didFitRef.current = true;
		setLayoutReady(true);
		sim.alpha(POSTPRETICK_ALPHA).alphaTarget(0).restart();
		renderRef.current();
	}, []);

	// Effect A: agent-scoped canvas + listeners. Reads simulationRef at event
	// time, so it does not need to re-run when the simulation is rebuilt.
	useEffect(() => {
		const container = containerRef.current;
		const canvas = canvasRef.current;
		if (!container || !canvas) {
			return;
		}
		const dpr = window.devicePixelRatio || 1;
		dprRef.current = dpr;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}
		ctxRef.current = ctx;

		function resize() {
			if (!container || !canvas) {
				return;
			}
			const rect = container.getBoundingClientRect();
			sizeRef.current = { width: rect.width, height: rect.height };
			canvas.width = Math.max(1, Math.floor(rect.width * dpr));
			canvas.height = Math.max(1, Math.floor(rect.height * dpr));
			canvas.style.width = `${rect.width}px`;
			canvas.style.height = `${rect.height}px`;
		}
		resize();
		// Track previous non-zero size so we can distinguish a real resize from
		// a hidden→shown transition (CSS `display:none` reports 0×0). When prev
		// size was 0 the change is a visibility flip — Effect D handles those;
		// the resize observer should not also fit, otherwise the user's view
		// would be reset twice.
		let prevWidth = sizeRef.current.width;
		let prevHeight = sizeRef.current.height;
		const resizeObserver = new ResizeObserver(() => {
			resize();
			const { width, height } = sizeRef.current;
			if (width === 0 || height === 0) {
				prevWidth = 0;
				prevHeight = 0;
				return;
			}
			const sim = simulationRef.current;
			if (sim) {
				const f = forcesRef.current;
				sim.force("center", forceCenter(width / 2, height / 2));
				sim.force("x", forceX<SimNode>(width / 2).strength(f.center));
				sim.force("y", forceY<SimNode>(height / 2).strength(f.center));
				// First time the container has real dimensions for this
				// simulation — perform the deferred initial fit. This covers the
				// case where the graph view was built while hidden (e.g., user
				// was in the file tree pane), so Effect B couldn't fit then.
				if (!didFitRef.current) {
					fitTransform({
						transformRef,
						sizeRef,
						nodes: nodesRef.current,
						padding: FIT_PADDING_PX,
					});
					didFitRef.current = true;
					setLayoutReady(true);
				} else if (
					prevWidth > 0 &&
					prevHeight > 0 &&
					(prevWidth !== width || prevHeight !== height)
				) {
					// Real resize while visible (split-bar drag, terminal
					// collapse/expand, window resize). Center forces above are
					// already updated; re-settle around them and refit.
					resettleAndFit();
				}
			}
			// Canvas size changes wipe the bitmap; repaint once so the freshly
			// shown canvas reflects current state without waiting for a tick.
			renderRef.current();
			prevWidth = width;
			prevHeight = height;
		});
		resizeObserver.observe(container);

		// Render closure captures ctx/dpr/canvas; everything else is via refs.
		const render = () => {
			if (!ctx || !canvas) {
				return;
			}
			const { width, height } = sizeRef.current;
			ctx.save();
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, width, height);

			const { scale, translateX, translateY } = transformRef.current;
			ctx.translate(translateX, translateY);
			ctx.scale(scale, scale);

			// Focused = hovered (transient) ∪ active file tab (sticky). Both
			// receive the same hover-style treatment per design choice. Neighbor
			// expansion is the union over every focused node.
			const hoveredNodeId = hoveredIdRef.current;
			const activePath = activeFilePathRef.current;
			const focusedIds = new Set<string>();
			if (hoveredNodeId) {
				focusedIds.add(hoveredNodeId);
			}
			if (activePath) {
				focusedIds.add(activePath);
			}
			const hasFocus = focusedIds.size > 0;
			const neighborIds = new Set<string>();
			if (hasFocus) {
				for (const id of focusedIds) {
					neighborIds.add(id);
				}
				for (const link of linksRef.current) {
					const sourceId = nodeId(link.source);
					const targetId = nodeId(link.target);
					if (focusedIds.has(sourceId)) {
						neighborIds.add(targetId);
					}
					if (focusedIds.has(targetId)) {
						neighborIds.add(sourceId);
					}
				}
			}

			ctx.lineWidth = 1 / scale;
			for (const link of linksRef.current) {
				const source = link.source as SimNode;
				const target = link.target as SimNode;
				if (
					source.x === undefined ||
					source.y === undefined ||
					target.x === undefined ||
					target.y === undefined
				) {
					continue;
				}
				const isHighlighted =
					hasFocus &&
					(focusedIds.has(nodeId(source)) || focusedIds.has(nodeId(target)));
				const isFaded = hasFocus && !isHighlighted;
				ctx.strokeStyle = isHighlighted
					? COLOR_EDGE_HIGHLIGHT
					: isFaded
						? COLOR_EDGE_FADED
						: COLOR_EDGE_IDLE;
				ctx.beginPath();
				ctx.moveTo(source.x, source.y);
				ctx.lineTo(target.x, target.y);
				ctx.stroke();
			}

			const now = performance.now();
			for (const node of nodesRef.current) {
				if (node.x === undefined || node.y === undefined) {
					continue;
				}
				const radius = computeNodeRadius(node.degree);
				const isHovered = focusedIds.has(node.id);
				const isNeighbor = hasFocus && neighborIds.has(node.id);
				const isFaded = hasFocus && !isNeighbor;
				const baseColor = node.resolved
					? isHovered
						? COLOR_NODE_RESOLVED_HOVER
						: COLOR_NODE_RESOLVED_IDLE
					: COLOR_NODE_UNRESOLVED;
				ctx.fillStyle = isFaded ? withAlpha(baseColor, 0.25) : baseColor;
				ctx.beginPath();
				ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
				ctx.fill();

				// Birth halo: brief glow for nodes that just appeared via merge.
				if (
					typeof node.birthAt === "number" &&
					now - node.birthAt < NODE_BIRTH_HIGHLIGHT_MS
				) {
					const progress = (now - node.birthAt) / NODE_BIRTH_HIGHLIGHT_MS;
					const haloAlpha = (1 - progress) * 0.7;
					ctx.strokeStyle = `rgba(${COLOR_HALO_RGB}, ${haloAlpha})`;
					ctx.lineWidth = 2 / scale;
					ctx.beginPath();
					ctx.arc(node.x, node.y, radius + 2 + progress * 6, 0, Math.PI * 2);
					ctx.stroke();
				}

				// Permanent label appears past a zoom threshold (Obsidian-style).
				// Hovered nodes always get a brighter label regardless of zoom.
				let labelAlpha = 0;
				if (isHovered) {
					labelAlpha = 0.95;
				} else if (!isFaded && scale >= LABEL_VISIBILITY_MIN_SCALE) {
					const fadeRange =
						LABEL_FULL_OPACITY_SCALE - LABEL_VISIBILITY_MIN_SCALE;
					const progress = (scale - LABEL_VISIBILITY_MIN_SCALE) / fadeRange;
					labelAlpha = LABEL_BASE_ALPHA * Math.min(1, Math.max(0, progress));
				}
				if (labelAlpha > 0) {
					ctx.fillStyle = `rgba(${COLOR_LABEL_RGB}, ${labelAlpha})`;
					ctx.font = `${11 / scale}px ui-sans-serif, system-ui, sans-serif`;
					ctx.textBaseline = "top";
					ctx.textAlign = "center";
					ctx.fillText(node.name, node.x, node.y + radius + 3 / scale);
					ctx.textAlign = "start";
				}
			}
			ctx.restore();
		};
		renderRef.current = render;

		function clientToWorld(clientX: number, clientY: number) {
			const rect = canvas?.getBoundingClientRect();
			if (!rect) {
				return { x: 0, y: 0 };
			}
			const localX = clientX - rect.left;
			const localY = clientY - rect.top;
			const { scale, translateX, translateY } = transformRef.current;
			return {
				x: (localX - translateX) / scale,
				y: (localY - translateY) / scale,
			};
		}

		function pickNodeAt(worldX: number, worldY: number): SimNode | null {
			const { scale } = transformRef.current;
			let best: SimNode | null = null;
			let bestDistance = Number.POSITIVE_INFINITY;
			for (const node of nodesRef.current) {
				if (node.x === undefined || node.y === undefined) {
					continue;
				}
				const dx = node.x - worldX;
				const dy = node.y - worldY;
				const distance = Math.hypot(dx, dy);
				const radius =
					computeNodeRadius(node.degree) + HOVER_RADIUS_PADDING / scale;
				if (distance <= radius && distance < bestDistance) {
					bestDistance = distance;
					best = node;
				}
			}
			return best;
		}

		function setHoveredIfChanged(nextId: string | null) {
			if (nextId === hoveredIdRef.current) {
				return;
			}
			hoveredIdRef.current = nextId;
			setHoveredId(nextId);
			render();
		}

		function pointerMoved(state: PointerState, event: MouseEvent): boolean {
			if (state.moved) {
				return true;
			}
			const dx = event.clientX - state.startClientX;
			const dy = event.clientY - state.startClientY;
			return Math.hypot(dx, dy) > POINTER_DRAG_THRESHOLD_PX;
		}

		function handleMouseMove(event: MouseEvent) {
			const state = pointerStateRef.current;
			if (state) {
				const moved = pointerMoved(state, event);
				state.moved = moved;
				if (state.mode === "node") {
					if (!moved) {
						return;
					}
					const world = clientToWorld(event.clientX, event.clientY);
					state.node.fx = world.x;
					state.node.fy = world.y;
					simulationRef.current?.alphaTarget(0.3).restart();
					return;
				}
				const dx = event.clientX - state.startClientX;
				const dy = event.clientY - state.startClientY;
				transformRef.current.translateX = state.originTranslateX + dx;
				transformRef.current.translateY = state.originTranslateY + dy;
				render();
				return;
			}
			const world = clientToWorld(event.clientX, event.clientY);
			const node = pickNodeAt(world.x, world.y);
			setHoveredIfChanged(node?.id ?? null);
		}

		function handleMouseDown(event: MouseEvent) {
			if (event.button !== 0) {
				return;
			}
			const world = clientToWorld(event.clientX, event.clientY);
			const node = pickNodeAt(world.x, world.y);
			if (node) {
				pointerStateRef.current = {
					mode: "node",
					node,
					startClientX: event.clientX,
					startClientY: event.clientY,
					moved: false,
				};
				return;
			}
			pointerStateRef.current = {
				mode: "pan",
				startClientX: event.clientX,
				startClientY: event.clientY,
				originTranslateX: transformRef.current.translateX,
				originTranslateY: transformRef.current.translateY,
				moved: false,
			};
			setIsPanning(true);
			setHoveredIfChanged(null);
		}

		function handleMouseUp(event: MouseEvent) {
			const state = pointerStateRef.current;
			if (!state) {
				return;
			}
			pointerStateRef.current = null;
			if (state.mode === "node") {
				const moved = pointerMoved(state, event);
				if (moved) {
					state.node.fx = null;
					state.node.fy = null;
					simulationRef.current?.alphaTarget(0);
					return;
				}
				if (state.node.resolved && state.node.path) {
					onOpenFile({ agentId, path: state.node.path });
				}
				return;
			}
			setIsPanning(false);
		}

		function handleWheel(event: WheelEvent) {
			event.preventDefault();
			const transform = transformRef.current;
			const rect = canvas?.getBoundingClientRect();
			if (!rect) {
				return;
			}
			const focusX = event.clientX - rect.left;
			const focusY = event.clientY - rect.top;
			const worldX = (focusX - transform.translateX) / transform.scale;
			const worldY = (focusY - transform.translateY) / transform.scale;
			const factor = Math.exp(-event.deltaY * 0.0015);
			const nextScale = Math.min(4, Math.max(0.2, transform.scale * factor));
			transform.scale = nextScale;
			transform.translateX = focusX - worldX * nextScale;
			transform.translateY = focusY - worldY * nextScale;
			render();
		}

		canvas.addEventListener("mousemove", handleMouseMove);
		canvas.addEventListener("mousedown", handleMouseDown);
		window.addEventListener("mouseup", handleMouseUp);
		canvas.addEventListener("wheel", handleWheel, { passive: false });

		return () => {
			resizeObserver.disconnect();
			canvas.removeEventListener("mousemove", handleMouseMove);
			canvas.removeEventListener("mousedown", handleMouseDown);
			window.removeEventListener("mouseup", handleMouseUp);
			canvas.removeEventListener("wheel", handleWheel);
			renderRef.current = () => {};
			ctxRef.current = null;
			pointerStateRef.current = null;
		};
	}, [agentId, onOpenFile, resettleAndFit]);

	// Effect B: simulation lifecycle. Builds on first data, merges thereafter.
	useEffect(() => {
		if (!simData) {
			return;
		}

		const isAgentSwitch = simulationAgentRef.current !== agentId;
		if (isAgentSwitch && simulationRef.current) {
			simulationRef.current.stop();
			simulationRef.current = null;
		}

		// First build for this agent — full pretick + fit + reveal.
		if (!simulationRef.current) {
			const { width, height } = sizeRef.current;
			const f = forcesRef.current;
			nodesRef.current = simData.nodes;
			linksRef.current = simData.links;
			didFitRef.current = false;
			setLayoutReady(false);

			const sim = forceSimulation<SimNode>(simData.nodes)
				.force(
					"link",
					forceLink<SimNode, SimLink>(simData.links)
						.id((node) => node.id)
						.distance(f.linkDistance)
						.strength(f.linkStrength),
				)
				.force(
					"charge",
					forceManyBody<SimNode>().strength(-f.repel).distanceMax(360),
				)
				.force(
					"collide",
					forceCollide<SimNode>().radius(
						(node) => computeNodeRadius(node.degree) + 3,
					),
				)
				.force("center", forceCenter(width / 2, height / 2))
				.force("x", forceX<SimNode>(width / 2).strength(f.center))
				.force("y", forceY<SimNode>(height / 2).strength(f.center))
				.alpha(1)
				.alphaDecay(0.02)
				.velocityDecay(0.45)
				.on("tick", () => renderRef.current());

			simulationRef.current = sim;
			simulationAgentRef.current = agentId;

			// Pre-settle without painting (simulation.tick does not dispatch).
			sim.stop();
			for (let i = 0; i < PRETICK_MAX_ITERATIONS; i += 1) {
				sim.tick();
				if (sim.alpha() < FIT_ALPHA_THRESHOLD) {
					break;
				}
			}
			// If the canvas has real dimensions, fit + reveal immediately.
			// Otherwise (e.g., the user is in the file tree pane and graph div
			// is `display: none`), defer the fit to the ResizeObserver — it
			// will fire when the container becomes visible.
			if (width > 0 && height > 0) {
				fitTransform({
					transformRef,
					sizeRef,
					nodes: nodesRef.current,
					padding: FIT_PADDING_PX,
				});
				didFitRef.current = true;
				setLayoutReady(true);
			}
			renderRef.current();
			sim.alpha(POSTPRETICK_ALPHA).alphaTarget(0).restart();
			return;
		}

		// Merge path: same agent, new graph data. Preserve positions.
		const sim = simulationRef.current;
		if (!graph) {
			return;
		}
		const merged = mergeSimData(nodesRef.current, graph);
		// Skip the merge entirely when nothing changed structurally — avoids
		// pointless reheating that disturbs the user's view.
		if (merged.addedIds.size === 0 && merged.removedIds.size === 0) {
			// Refresh metadata only (e.g., a node switched from unresolved to
			// resolved). Re-run the link force to refresh per-link distance.
			nodesRef.current = merged.nodes;
			linksRef.current = merged.links;
			const linkForce =
				sim.force<ReturnType<typeof forceLink<SimNode, SimLink>>>("link");
			if (linkForce) {
				linkForce.links(merged.links);
			}
			renderRef.current();
			return;
		}

		// Drop dragged/hovered references that point at removed nodes.
		if (
			pointerStateRef.current?.mode === "node" &&
			merged.removedIds.has(pointerStateRef.current.node.id)
		) {
			pointerStateRef.current = null;
		}
		if (hoveredIdRef.current && merged.removedIds.has(hoveredIdRef.current)) {
			hoveredIdRef.current = null;
			setHoveredId(null);
		}

		nodesRef.current = merged.nodes;
		linksRef.current = merged.links;

		// d3-force initialization is fragile across structural changes: setting
		// links first throws when a link references a not-yet-added node, and
		// setting nodes first throws when an existing link references a removed
		// node. The safest path is to drop the link force, swap the node set,
		// then attach a fresh link force whose initialize sees both new arrays.
		const f = forcesRef.current;
		sim.force("link", null);
		sim.nodes(merged.nodes);
		sim.force(
			"link",
			forceLink<SimNode, SimLink>(merged.links)
				.id((node) => node.id)
				.distance(f.linkDistance)
				.strength(f.linkStrength),
		);
		sim.alpha(MERGE_ALPHA).alphaTarget(0).restart();
	}, [simData, agentId, graph]);

	// Effect C: live force tuning. Updates in place, no rebuild.
	useEffect(() => {
		const sim = simulationRef.current;
		if (!sim) {
			return;
		}
		const { width, height } = sizeRef.current;
		const linkForce =
			sim.force<ReturnType<typeof forceLink<SimNode, SimLink>>>("link");
		if (linkForce) {
			linkForce.distance(forces.linkDistance).strength(forces.linkStrength);
		}
		const chargeForce =
			sim.force<ReturnType<typeof forceManyBody<SimNode>>>("charge");
		if (chargeForce) {
			chargeForce.strength(-forces.repel);
		}
		sim.force("x", forceX<SimNode>(width / 2).strength(forces.center));
		sim.force("y", forceY<SimNode>(height / 2).strength(forces.center));
		sim.alpha(0.4).restart();
		saveStoredForces(forces);
	}, [forces]);

	// Effect D: visibility-driven deferred fit. ResizeObserver behaviour for
	// `display: none → block` transitions varies across browsers and React
	// commit timings, so we drive the fit explicitly from the prop instead.
	// We retry across animation frames if the browser hasn't reflowed yet
	// when the effect first runs, and also re-attempt once the simulation
	// finally exists (in case the user toggled before fetch landed).
	useEffect(() => {
		if (!isVisible) {
			return;
		}
		let cancelled = false;
		let raf = 0;
		let attempts = 0;
		const MAX_ATTEMPTS = 20; // ~333ms at 60fps — generous safety margin.

		const attempt = () => {
			if (cancelled) {
				return;
			}
			const container = containerRef.current;
			const canvas = canvasRef.current;
			if (!container || !canvas) {
				return;
			}
			const rect = container.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) {
				// Browser may not have applied the layout change yet. Retry
				// next frame, with an attempt cap so we never spin forever.
				if (attempts < MAX_ATTEMPTS) {
					attempts += 1;
					raf = requestAnimationFrame(attempt);
				}
				return;
			}
			const dpr = dprRef.current;
			sizeRef.current = { width: rect.width, height: rect.height };
			canvas.width = Math.max(1, Math.floor(rect.width * dpr));
			canvas.height = Math.max(1, Math.floor(rect.height * dpr));
			canvas.style.width = `${rect.width}px`;
			canvas.style.height = `${rect.height}px`;

			const sim = simulationRef.current;
			if (sim) {
				const f = forcesRef.current;
				sim.force("center", forceCenter(rect.width / 2, rect.height / 2));
				sim.force("x", forceX<SimNode>(rect.width / 2).strength(f.center));
				sim.force("y", forceY<SimNode>(rect.height / 2).strength(f.center));
				if (!didFitRef.current) {
					// The simulation was built while the canvas was hidden, so
					// pretick happened around (0, 0). Re-settle around the real
					// center synchronously before fitting — otherwise nodes
					// drift toward the new center after fit and the view
					// silently goes off-screen.
					resettleAndFit();
					return;
				}
			} else if (!didFitRef.current && attempts < MAX_ATTEMPTS) {
				// Simulation hasn't been built yet (e.g., fetch still in
				// flight). Keep watching so we can fit the moment it appears.
				attempts += 1;
				raf = requestAnimationFrame(attempt);
				return;
			}
			renderRef.current();
		};
		attempt();

		return () => {
			cancelled = true;
			if (raf) {
				cancelAnimationFrame(raf);
			}
		};
	}, [isVisible, resettleAndFit]);

	// Effect E: when the active file tab changes, repaint once. The simulation
	// may be at rest (alpha ~ 0) so no tick would otherwise refresh the focus
	// styling on the now-active node.
	useEffect(() => {
		// activeFilePath is read inside renderRef.current() via activeFilePathRef.
		void activeFilePath;
		renderRef.current();
	}, [activeFilePath]);

	const updateForce = useCallback(
		<K extends keyof GraphForces>(key: K, value: GraphForces[K]) => {
			setForces((current) => ({ ...current, [key]: value }));
		},
		[],
	);

	const resetForces = useCallback(() => {
		setForces(DEFAULT_FORCES);
	}, []);

	// Manual fit button: re-settle and re-center, same cadence as resize. The
	// button is "show me the whole graph" — not "rebuild from scratch". When
	// the sim is already at rest the pretick is a near no-op, so this is
	// effectively a recenter; when the sim is still active (e.g., right after
	// dragging a node) the settle is meaningful.
	const fitToView = resettleAndFit;

	const hoveredNode = hoveredId
		? (graph?.nodes.find((node) => node.id === hoveredId) ?? null)
		: null;

	const cursorClass = isPanning
		? "cursor-grabbing"
		: hoveredId
			? "cursor-pointer"
			: "cursor-grab";

	const isEmpty = !loading && !error && (!graph || graph.nodes.length === 0);
	const overlayMessage = error
		? error
		: loading
			? "Loading graph…"
			: isEmpty
				? "No markdown notes to graph."
				: !layoutReady
					? "Computing layout…"
					: null;

	const canShowControls = !loading && !error && !isEmpty;

	// Always render the canvas so refs attach immediately. Loading/empty/error
	// states are overlays on top — early-returning before the canvas mounts
	// would leave the canvas-setup effect with null refs and never re-run.
	return (
		<div ref={containerRef} className="relative h-full w-full overflow-hidden">
			<canvas
				ref={canvasRef}
				className={`absolute inset-0 transition-opacity duration-200 ${cursorClass} ${
					layoutReady && canShowControls ? "opacity-100" : "opacity-0"
				}`}
			/>
			{overlayMessage ? (
				<div
					className={`font-mono-ui pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-[11px] uppercase tracking-[0.16em] ${
						error ? "text-danger" : "text-dark-500"
					}`}
				>
					{overlayMessage}
				</div>
			) : null}
			{graph && canShowControls ? (
				<div className="font-mono-ui pointer-events-none absolute left-3 top-3 text-[10px] uppercase tracking-[0.16em] text-dark-500">
					{graph.nodes.length} nodes · {graph.links.length} links
				</div>
			) : null}
			<div className="absolute right-3 top-3 flex flex-col items-end gap-2">
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={fitToView}
						aria-label="Fit graph to view"
						title="Fit to view"
						disabled={!canShowControls}
						className="flex h-6 w-6 items-center justify-center rounded border border-dark-800 bg-dark-900/80 text-dark-500 transition-colors hover:text-dark-100 disabled:cursor-not-allowed disabled:opacity-40"
					>
						<Maximize2 size={12} />
					</button>
					<button
						type="button"
						onClick={() => setForcesPanelOpen((current) => !current)}
						aria-label={
							forcesPanelOpen ? "Hide forces panel" : "Show forces panel"
						}
						title="Forces"
						disabled={!canShowControls}
						className={`flex h-6 w-6 items-center justify-center rounded border border-dark-800 bg-dark-900/80 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
							forcesPanelOpen
								? "text-dark-100"
								: "text-dark-500 hover:text-dark-100"
						}`}
					>
						{forcesPanelOpen ? <X size={12} /> : <Sliders size={12} />}
					</button>
				</div>
				{forcesPanelOpen ? (
					<ForcesPanel
						forces={forces}
						onChange={updateForce}
						onReset={resetForces}
					/>
				) : null}
			</div>
			{hoveredNode ? (
				<div className="pointer-events-none absolute bottom-3 left-3 right-3 truncate rounded bg-dark-900/90 px-2 py-1 text-xs text-dark-100">
					{hoveredNode.resolved
						? hoveredNode.path
						: `unresolved: ${hoveredNode.name}`}
				</div>
			) : null}
		</div>
	);
}

function nodeId(value: string | number | SimNode): string {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number") {
		return String(value);
	}
	return value.id;
}

function withAlpha(color: string, alpha: number): string {
	if (color.startsWith("rgb(")) {
		return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
	}
	return color;
}
