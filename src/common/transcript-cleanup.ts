const OAI_MEMORY_CITATION_BLOCK =
	/<oai-mem-citation>\s*<citation_entries>[\s\S]*?<\/citation_entries>\s*<rollout_ids>[\s\S]*?<\/rollout_ids>\s*<\/oai-mem-citation>/g;

export function stripOaiMemoryCitationBlocks(text: string): string {
	if (!text.includes("<oai-mem-citation>")) {
		return text;
	}
	const stripped = text.replace(OAI_MEMORY_CITATION_BLOCK, "");
	if (stripped === text) {
		return text;
	}
	return stripped.replace(/\n{3,}/g, "\n\n").trim();
}

export function isCodingTranscriptSilentEvent(event: unknown): boolean {
	if (!event || typeof event !== "object") {
		return false;
	}
	const record = event as { toolKind?: unknown; type?: unknown };
	const type = record.type;
	if (type === "usage_updated" || type === "image") {
		return true;
	}
	if (type !== "tool_call_started" && type !== "tool_call_completed") {
		return false;
	}
	return (
		record.toolKind === "write_stdin" ||
		record.toolKind === "custom_tool_call_output"
	);
}
