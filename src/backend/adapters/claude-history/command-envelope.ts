const COMMAND_ENVELOPE_TAG_PATTERN =
	/<command-(?:message|name|args)>[\s\S]*?<\/command-(?:message|name|args)>/g;

export function restoreClaudeCommandPrompt(text: string): string {
	if (!text.includes("<command-name>")) {
		return text;
	}

	const commandName = extractTagText(text, "command-name")?.trim();
	if (!commandName) {
		return text;
	}

	const extraContent = text.replace(COMMAND_ENVELOPE_TAG_PATTERN, "").trim();
	if (extraContent !== "") {
		return text;
	}

	const restoredName = unescapeXml(commandName);
	if (!restoredName.startsWith("/")) {
		return text;
	}

	const commandArgs = extractTagText(text, "command-args")?.trim();
	if (!commandArgs) {
		return restoredName;
	}

	return `${restoredName} ${unescapeXml(commandArgs)}`;
}

function extractTagText(text: string, tagName: string): string | undefined {
	const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`);
	return text.match(pattern)?.[1];
}

function unescapeXml(value: string): string {
	return value.replace(
		/&(?:amp|lt|gt|quot|apos);/g,
		(entity) => XML_ENTITIES[entity] ?? entity,
	);
}

const XML_ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&apos;": "'",
};
