import { CommitGraph } from "commit-graph";
import { useEffect, useRef } from "react";
import type { BrowserGitGraph } from "../../../../common/protocol.ts";
import { formatGitGraphTooltip } from "./git-graph-format.ts";
import { measureGitGraphCompactHeight } from "./git-graph-layout.ts";
import { GIT_GRAPH_STYLE } from "./git-graph-style.ts";
import { truncateGitGraphMessage } from "./git-graph-truncate.ts";

const graphDateFormatter = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
});

function formatGitGraphDate(value: string | number | Date): string {
	return graphDateFormatter.format(new Date(value));
}

interface GitGraphProps {
	currentBranch: string | null;
	graph: BrowserGitGraph;
}

export function GitGraph({ currentBranch, graph }: GitGraphProps) {
	const rootRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const root = rootRef.current;
		if (!root) {
			return;
		}

		const syncCompactGraphLayout = () => {
			const graphRoot = root.querySelector<HTMLElement>(
				".git-graph-canvas > [class*='index-module_container__']",
			);
			const commitInfoContainer = root.querySelector<HTMLElement>(
				'[class*="index-module_commitInfoContainer__"]',
			);
			const detailNodes = root.querySelectorAll<HTMLElement>(
				'[class*="index-module_details__"]',
			);
			const lastDetail = detailNodes.item(detailNodes.length - 1);
			if (!graphRoot || !commitInfoContainer || !lastDetail) {
				return;
			}

			commitInfoContainer.style.left = "36px";
			commitInfoContainer.style.width = "calc(100% - 36px)";
			commitInfoContainer.style.minWidth = "0";

			const messageNodes = root.querySelectorAll<HTMLElement>(
				'[class*="index-module_msg__"]',
			);
			for (const [index, node] of messageNodes.entries()) {
				const commit = graph.commits[index];
				if (!commit) {
					continue;
				}

				const tooltip = formatGitGraphTooltip(commit);
				const fullMessage = commit.commit.message;
				node.title = tooltip;
				node.setAttribute("data-tooltip-content", tooltip);
				node.textContent = truncateGitGraphMessage(
					fullMessage,
					node.clientWidth,
					(value) => {
						node.textContent = value;
						return node.scrollWidth;
					},
				);
			}

			const nextHeight = measureGitGraphCompactHeight(graphRoot, lastDetail);
			graphRoot.style.height = `${nextHeight}px`;
		};

		let frame = requestAnimationFrame(syncCompactGraphLayout);
		const resizeObserver =
			typeof ResizeObserver === "undefined"
				? undefined
				: new ResizeObserver(() => {
						cancelAnimationFrame(frame);
						frame = requestAnimationFrame(syncCompactGraphLayout);
					});
		resizeObserver?.observe(root);

		return () => {
			cancelAnimationFrame(frame);
			resizeObserver?.disconnect();
		};
	}, [graph]);

	if (graph.commits.length === 0) {
		return (
			<div className="px-2 py-1 text-sm text-dark-500">
				No commit history yet.
			</div>
		);
	}

	return (
		<div
			ref={rootRef}
			className="git-graph-shell overflow-hidden rounded bg-dark-950/60 px-2 py-1.5 text-dark-200"
		>
			<div className="git-graph-canvas w-full min-w-0">
				<CommitGraph
					commits={graph.commits}
					branchHeads={graph.branchHeads}
					currentBranch={currentBranch ?? undefined}
					dateFormatFn={formatGitGraphDate}
					graphStyle={GIT_GRAPH_STYLE}
				/>
			</div>
		</div>
	);
}
