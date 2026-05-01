const LIBRARY_ROW_HEIGHT_PX = 64;
const COMPACT_GRAPH_ROW_HEIGHT_PX = 20;
const COMPACT_GRAPH_BOTTOM_PADDING_PX = 8;
const COMPACT_GRAPH_INFO_GAP_PX = 8;
const COMPACT_GRAPH_ROW_OFFSET_PX =
	(LIBRARY_ROW_HEIGHT_PX - COMPACT_GRAPH_ROW_HEIGHT_PX) / 2;
const GIT_GRAPH_EXPANSION_GAP_PX = 8;
const DEFAULT_GIT_GRAPH_INFO_OFFSET_PX = 44;

interface RectLike {
	getBoundingClientRect(): Pick<DOMRect, "top" | "bottom">;
}

interface WidthLike {
	getBoundingClientRect(): Pick<DOMRect, "width">;
}

interface HeightLike {
	getBoundingClientRect(): Pick<DOMRect, "height">;
}

export function measureGitGraphCompactHeight(
	graphRoot: RectLike,
	lastDetail: RectLike,
): number {
	const graphTop = graphRoot.getBoundingClientRect().top;
	const detailBottom = lastDetail.getBoundingClientRect().bottom;
	return Math.max(
		0,
		Math.ceil(detailBottom - graphTop + COMPACT_GRAPH_BOTTOM_PADDING_PX),
	);
}

export function measureGitGraphExpansionTop(
	graphRoot: RectLike,
	selectedDetail: RectLike,
): number {
	const graphTop = graphRoot.getBoundingClientRect().top;
	const detailBottom = selectedDetail.getBoundingClientRect().bottom;
	return Math.max(
		0,
		Math.ceil(detailBottom - graphTop + GIT_GRAPH_EXPANSION_GAP_PX),
	);
}

export function measureGitGraphExpandedHeight(
	compactHeight: number,
	expansionTop: number,
	expandedCard: HeightLike,
): number {
	return Math.max(
		compactHeight,
		Math.max(
			0,
			Math.ceil(
				expansionTop +
					expandedCard.getBoundingClientRect().height +
					COMPACT_GRAPH_BOTTOM_PADDING_PX,
			),
		),
	);
}

export function measureGitGraphInfoOffset(svgRoot: WidthLike): number {
	const svgWidth = svgRoot.getBoundingClientRect().width;
	return Math.max(
		COMPACT_GRAPH_INFO_GAP_PX,
		Math.ceil(svgWidth + COMPACT_GRAPH_INFO_GAP_PX),
	);
}

export function estimateGitGraphExpansionTop(commitIndex: number): number {
	return (
		commitIndex * LIBRARY_ROW_HEIGHT_PX +
		COMPACT_GRAPH_ROW_OFFSET_PX +
		COMPACT_GRAPH_ROW_HEIGHT_PX +
		GIT_GRAPH_EXPANSION_GAP_PX
	);
}

export function getDefaultGitGraphInfoOffset(): number {
	return DEFAULT_GIT_GRAPH_INFO_OFFSET_PX;
}
