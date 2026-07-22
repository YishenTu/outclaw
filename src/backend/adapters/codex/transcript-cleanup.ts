const OAI_MEMORY_CITATION_BLOCK =
	/<oai-mem-citation>\s*<citation_entries>[\s\S]*?<\/citation_entries>\s*<rollout_ids>[\s\S]*?<\/rollout_ids>\s*<\/oai-mem-citation>/g;

const CODEX_SKILL_BLOCK =
	/(^|\n)[ \t]*<skill>\s*<name>[\s\S]*?<\/name>\s*<path>[\s\S]*?<\/path>[\s\S]*?<\/skill>[ \t]*(?=\n|$)/g;

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

export function normalizeCodexJsonlUserPromptText(text: string): string {
	return stripCodexSkillBlocks(
		stripCodexEnvironmentContextBlocks(
			stripCodexSessionBootstrapText(stripCodexRecommendedPluginsBlock(text)),
		),
	);
}

function stripCodexRecommendedPluginsBlock(text: string): string {
	const trimmedStart = text.trimStart();
	if (!trimmedStart.startsWith("<recommended_plugins>")) {
		return text;
	}

	const blockEnd = trimmedStart.indexOf("</recommended_plugins>");
	if (blockEnd === -1) {
		return text;
	}

	return trimmedStart
		.slice(blockEnd + "</recommended_plugins>".length)
		.trimStart();
}

function stripCodexSkillBlocks(text: string): string {
	if (!text.includes("<skill>")) {
		return text;
	}
	const stripped = text.replace(CODEX_SKILL_BLOCK, "\n");
	if (stripped === text) {
		return text;
	}
	return stripped.replace(/\n{3,}/g, "\n\n").trim();
}

function stripCodexSessionBootstrapText(text: string): string {
	const trimmedStart = text.trimStart();
	if (!isCodexSessionBootstrapText(trimmedStart)) {
		return text;
	}

	const environmentEnd = trimmedStart.indexOf("</environment_context>");
	if (environmentEnd === -1) {
		return "";
	}

	return trimmedStart
		.slice(environmentEnd + "</environment_context>".length)
		.trim();
}

function stripCodexEnvironmentContextBlocks(text: string): string {
	let stripped = text;
	while (true) {
		const trimmedStart = stripped.trimStart();
		if (!trimmedStart.startsWith("<environment_context>")) {
			return stripped;
		}

		const environmentEnd = trimmedStart.indexOf("</environment_context>");
		if (environmentEnd === -1) {
			return stripped;
		}

		stripped = trimmedStart
			.slice(environmentEnd + "</environment_context>".length)
			.trim();
	}
}

function isCodexSessionBootstrapText(text: string): boolean {
	return (
		text.startsWith("# AGENTS.md instructions for ") &&
		text.includes("\n<INSTRUCTIONS>") &&
		text.includes("\n</INSTRUCTIONS>") &&
		text.includes("<environment_context>")
	);
}
