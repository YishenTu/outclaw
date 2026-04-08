import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
	ContentBlockParam,
	MessageParam,
} from "@anthropic-ai/sdk/resources/messages/messages";
import {
	extractError,
	type Facade,
	type FacadeEvent,
	type RunParams,
	type UsageInfo,
} from "../../common/protocol.ts";
import { extractImageEvents } from "./image-events.ts";

function extractUsage(event: {
	modelUsage?: Record<
		string,
		{ contextWindow?: number; maxOutputTokens?: number }
	>;
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		cache_creation_input_tokens?: number;
		cache_read_input_tokens?: number;
	};
}): UsageInfo | undefined {
	const usage = event.usage;
	if (!usage) return undefined;

	const inputTokens = usage.input_tokens ?? 0;
	const outputTokens = usage.output_tokens ?? 0;
	const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
	const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
	const contextTokens = inputTokens + cacheCreationTokens + cacheReadTokens;

	// Get context window from modelUsage (authoritative)
	const modelEntry = event.modelUsage
		? Object.values(event.modelUsage)[0]
		: undefined;
	const contextWindow = modelEntry?.contextWindow ?? 200_000;
	const maxOutputTokens = modelEntry?.maxOutputTokens ?? 32_000;

	const percentage =
		contextWindow > 0
			? Math.min(100, Math.round((contextTokens / contextWindow) * 100))
			: 0;

	return {
		inputTokens,
		outputTokens,
		cacheCreationTokens,
		cacheReadTokens,
		contextWindow,
		maxOutputTokens,
		contextTokens,
		percentage,
	};
}

type PermissionMode = "default" | "plan" | "bypassPermissions";

export class ClaudeAdapter implements Facade {
	private permissionMode: PermissionMode;

	constructor(permissionMode: PermissionMode = "bypassPermissions") {
		this.permissionMode = permissionMode;
	}

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		const abortController = params.abortController ?? new AbortController();
		const emittedImagePaths = new Set<string>();

		try {
			const conversation = query({
				prompt: createPromptInput(params),
				options: {
					systemPrompt: params.systemPrompt,
					abortController,
					resume: params.resume,
					cwd: params.cwd,
					model: params.model,
					effort: params.effort as
						| "low"
						| "medium"
						| "high"
						| "max"
						| undefined,
					permissionMode: this.permissionMode,
					allowDangerouslySkipPermissions:
						this.permissionMode === "bypassPermissions",
					includePartialMessages: true,
				},
			});

			for await (const event of conversation) {
				if (event.type === "stream_event") {
					const raw = event.event;
					if (
						raw.type === "content_block_delta" &&
						raw.delta.type === "text_delta"
					) {
						yield { type: "text", text: raw.delta.text };
					}
					continue;
				}

				yield* extractImageEvents(event, emittedImagePaths);

				if (event.type === "result") {
					yield {
						type: "done",
						sessionId: event.session_id,
						durationMs: event.duration_ms,
						costUsd: event.total_cost_usd,
						usage: extractUsage(event),
					};
				}
			}
		} catch (err) {
			yield { type: "error", message: extractError(err) };
		}
	}
}

function createPromptInput(
	params: RunParams,
): string | AsyncIterable<SDKUserMessage> {
	if (!params.images || params.images.length === 0) {
		return params.prompt;
	}

	return (async function* (): AsyncIterable<SDKUserMessage> {
		const content: ContentBlockParam[] = [];

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

		if (params.prompt) {
			content.push({ type: "text", text: params.prompt });
		}

		const message: MessageParam = {
			role: "user",
			content,
		};

		yield {
			type: "user",
			message,
			parent_tool_use_id: null,
		};
	})();
}
