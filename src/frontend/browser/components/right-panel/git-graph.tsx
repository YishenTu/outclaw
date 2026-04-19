import { CommitGraph, type CommitNode } from "commit-graph";
import { useEffect, useRef, useState } from "react";
import type {
	BrowserGitGraph,
	BrowserGitGraphCommit,
} from "../../../../common/protocol.ts";
import {
	estimateGitGraphExpansionTop,
	getDefaultGitGraphInfoOffset,
	measureGitGraphCompactHeight,
	measureGitGraphExpandedHeight,
	measureGitGraphExpansionTop,
	measureGitGraphInfoOffset,
} from "./git-graph-layout.ts";
import { GIT_GRAPH_STYLE } from "./git-graph-style.ts";
import { truncateGitGraphMessage } from "./git-graph-truncate.ts";
import { GitSelectedCommitCard } from "./git-selected-commit-card.tsx";

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
	onOpenCommit?: (commit: BrowserGitGraphCommit) => void;
	onSelectCommit?: (sha: string | null) => void;
	selectedCommitSha?: string | null;
}

interface GitGraphExpansionLayout {
	commitSha: string;
	inset: number;
	top: number;
}

export function GitGraph({
	currentBranch,
	graph,
	onOpenCommit,
	onSelectCommit,
	selectedCommitSha = null,
}: GitGraphProps) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const expansionRef = useRef<HTMLDivElement | null>(null);
	const [expansionLayout, setExpansionLayout] =
		useState<GitGraphExpansionLayout | null>(null);
	const selectedCommitIndex =
		selectedCommitSha === null
			? -1
			: graph.commits.findIndex((commit) => commit.sha === selectedCommitSha);
	const selectedCommit =
		selectedCommitIndex === -1 ? undefined : graph.commits[selectedCommitIndex];

	useEffect(() => {
		const root = rootRef.current;
		if (!root) {
			return;
		}

		const syncCompactGraphLayout = () => {
			const graphCanvas = root.querySelector<HTMLElement>(".git-graph-canvas");
			const graphRoot = root.querySelector<HTMLElement>(
				".git-graph-canvas > [class*='index-module_container__']",
			);
			const commitInfoContainer = root.querySelector<HTMLElement>(
				'[class*="index-module_commitInfoContainer__"]',
			);
			const svgRoot = root.querySelector<SVGSVGElement>(
				".git-graph-canvas svg",
			);
			const detailNodes = root.querySelectorAll<HTMLElement>(
				'[class*="index-module_details__"]',
			);
			const lastDetail = detailNodes.item(detailNodes.length - 1);
			if (
				!graphCanvas ||
				!graphRoot ||
				!commitInfoContainer ||
				!svgRoot ||
				!lastDetail
			) {
				return;
			}

			const infoOffset = measureGitGraphInfoOffset(svgRoot);
			commitInfoContainer.style.left = `${infoOffset}px`;
			commitInfoContainer.style.width = `calc(100% - ${infoOffset}px)`;
			commitInfoContainer.style.minWidth = "0";

			const messageNodes = root.querySelectorAll<HTMLElement>(
				'[class*="index-module_msg__"]',
			);
			for (const [index, node] of messageNodes.entries()) {
				const commit = graph.commits[index];
				if (!commit) {
					continue;
				}

				const fullMessage = commit.commit.message;
				node.removeAttribute("title");
				node.removeAttribute("data-tooltip-content");
				node.textContent = truncateGitGraphMessage(
					fullMessage,
					node.clientWidth,
					(value) => {
						node.textContent = value;
						return node.scrollWidth;
					},
				);
			}

			const compactHeight = measureGitGraphCompactHeight(
				graphCanvas,
				lastDetail,
			);
			let nextHeight = compactHeight;
			if (selectedCommit && expansionRef.current) {
				const selectedDetail =
					selectedCommitIndex >= 0
						? detailNodes.item(selectedCommitIndex)
						: null;
				const expansionTop =
					selectedDetail === null
						? estimateGitGraphExpansionTop(selectedCommitIndex)
						: measureGitGraphExpansionTop(graphCanvas, selectedDetail);
				nextHeight = measureGitGraphExpandedHeight(
					compactHeight,
					expansionTop,
					expansionRef.current,
				);
				setExpansionLayout((previousLayout) => {
					if (
						previousLayout?.commitSha === selectedCommit.sha &&
						previousLayout.inset === infoOffset &&
						previousLayout.top === expansionTop
					) {
						return previousLayout;
					}

					return {
						commitSha: selectedCommit.sha,
						inset: infoOffset,
						top: expansionTop,
					};
				});
			} else {
				setExpansionLayout((previousLayout) =>
					previousLayout === null ? previousLayout : null,
				);
			}
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
	}, [graph, selectedCommit, selectedCommitIndex]);

	if (graph.commits.length === 0) {
		return (
			<div className="px-2 py-1 text-sm text-dark-500">
				No commit history yet.
			</div>
		);
	}

	const expansionInset =
		selectedCommit && expansionLayout?.commitSha === selectedCommit.sha
			? expansionLayout.inset
			: getDefaultGitGraphInfoOffset();
	const expansionTop =
		selectedCommit && expansionLayout?.commitSha === selectedCommit.sha
			? expansionLayout.top
			: estimateGitGraphExpansionTop(Math.max(selectedCommitIndex, 0));

	return (
		<div
			ref={rootRef}
			className="git-graph-shell overflow-hidden rounded bg-dark-950/60 px-2 py-1.5 text-dark-200"
		>
			<div className="git-graph-canvas relative w-full min-w-0">
				<CommitGraph
					commits={graph.commits}
					branchHeads={graph.branchHeads}
					currentBranch={currentBranch ?? undefined}
					dateFormatFn={formatGitGraphDate}
					graphStyle={GIT_GRAPH_STYLE}
					onCommitClick={(commit: CommitNode) =>
						onSelectCommit?.(
							selectedCommitSha === commit.hash ? null : commit.hash,
						)
					}
				/>
				{selectedCommit ? (
					<div
						ref={expansionRef}
						className="git-graph-expansion absolute inset-x-0 z-10"
						style={{
							paddingLeft: `${expansionInset}px`,
							top: `${expansionTop}px`,
						}}
					>
						<GitSelectedCommitCard
							commit={selectedCommit}
							onOpenCommit={onOpenCommit}
						/>
					</div>
				) : null}
			</div>
		</div>
	);
}
