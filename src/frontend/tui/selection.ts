export function clampSelectionIndex(index: number, count: number): number {
	if (count <= 0) {
		return 0;
	}

	return Math.max(0, Math.min(index, count - 1));
}

export function moveWrappedSelection(
	index: number,
	count: number,
	direction: -1 | 1,
): number {
	if (count <= 0) {
		return 0;
	}

	if (direction === -1) {
		return index > 0 ? index - 1 : count - 1;
	}

	return index < count - 1 ? index + 1 : 0;
}
