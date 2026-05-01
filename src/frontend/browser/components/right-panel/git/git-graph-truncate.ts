const GIT_GRAPH_TRUNCATION_SUFFIX = "...";
const GIT_GRAPH_TRUNCATION_SEPARATOR = " ";

function formatTruncatedMessage(prefix: string): string {
	return `${prefix.trimEnd()}${GIT_GRAPH_TRUNCATION_SEPARATOR}${GIT_GRAPH_TRUNCATION_SUFFIX}`;
}

export function truncateGitGraphMessage(
	message: string,
	maxWidth: number,
	measure: (value: string) => number,
): string {
	if (message.length === 0) {
		return "";
	}

	if (maxWidth <= 0) {
		return GIT_GRAPH_TRUNCATION_SUFFIX;
	}

	if (measure(message) <= maxWidth) {
		return message;
	}

	let low = 0;
	let high = message.length;

	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		const candidate = formatTruncatedMessage(message.slice(0, mid));
		if (measure(candidate) <= maxWidth) {
			low = mid;
			continue;
		}
		high = mid - 1;
	}

	return low > 0
		? formatTruncatedMessage(message.slice(0, low))
		: GIT_GRAPH_TRUNCATION_SUFFIX;
}
