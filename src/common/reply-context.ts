import type { ReplyContext } from "./protocol.ts";

const REPLY_CONTEXT_SUFFIX_PATTERN =
	/^(?:([\s\S]*?)\n\n)?<reply-context>([\s\S]*?)<\/reply-context>$/;

export function createReplyContext(
	text: string | undefined,
): ReplyContext | undefined {
	const normalized = text?.trim();
	if (!normalized) {
		return undefined;
	}

	return { text: normalized };
}

export function buildPromptWithReplyContext(
	prompt: string,
	replyContext: ReplyContext | undefined,
): string {
	if (!replyContext) {
		return prompt;
	}

	const envelope = buildReplyContextEnvelope(replyContext);

	return prompt ? `${prompt}\n\n${envelope}` : envelope;
}

export function parsePromptWithReplyContext(prompt: string): {
	prompt: string;
	replyContext: ReplyContext | undefined;
} {
	const suffixMatch = prompt.match(REPLY_CONTEXT_SUFFIX_PATTERN);
	if (suffixMatch) {
		return {
			prompt: suffixMatch[1] ?? "",
			replyContext: createReplyContext(unescapeXml(suffixMatch[2] ?? "")),
		};
	}

	return {
		prompt,
		replyContext: undefined,
	};
}

function buildReplyContextEnvelope(replyContext: ReplyContext): string {
	return `<reply-context>${escapeXml(replyContext.text)}</reply-context>`;
}

function escapeXml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => {
		switch (char) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			case "'":
				return "&apos;";
			default:
				return char;
		}
	});
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
