const COMPACT_GRAPH_BOTTOM_PADDING_PX = 8;

interface RectLike {
	getBoundingClientRect(): Pick<DOMRect, "top" | "bottom">;
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
