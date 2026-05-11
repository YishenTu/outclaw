import type { ImageMediaType, RunParams } from "../../../common/protocol.ts";
import { buildPromptWithReplyContext } from "../../../common/reply-context.ts";

export interface ClaudeSdkUserMessage {
	type: "user";
	message: ClaudeMessageParam;
	parent_tool_use_id: string | null;
}

type ClaudeContentBlockParam =
	| {
			type: "text";
			text: string;
	  }
	| {
			type: "image";
			source: {
				type: "base64";
				data: string;
				media_type: ImageMediaType;
			};
	  };

interface ClaudeMessageParam {
	role: "user";
	content: string | ClaudeContentBlockParam[];
}

export function createClaudePromptInput(
	params: RunParams,
): string | AsyncIterable<ClaudeSdkUserMessage> {
	const prompt = buildPromptWithReplyContext(
		params.prompt,
		params.replyContext,
	);

	if (!params.images || params.images.length === 0) {
		return prompt;
	}

	return (async function* (): AsyncIterable<ClaudeSdkUserMessage> {
		const content: ClaudeContentBlockParam[] = [];

		for (const image of params.images ?? []) {
			const data = Buffer.from(
				await Bun.file(image.path).arrayBuffer(),
			).toString("base64");
			content.push({
				type: "image",
				source: {
					type: "base64",
					data,
					media_type: image.mediaType,
				},
			});
		}

		if (prompt) {
			content.push({ type: "text", text: prompt });
		}

		yield {
			type: "user",
			message: {
				role: "user",
				content,
			},
			parent_tool_use_id: null,
		};
	})();
}
