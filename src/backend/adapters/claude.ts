import { query } from "@anthropic-ai/claude-agent-sdk";
import {
	extractError,
	type Facade,
	type FacadeEvent,
	type RunParams,
	type UsageInfo,
} from "../../common/protocol.ts";

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

export class ClaudeAdapter implements Facade {
	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		const abortController = params.abortController ?? new AbortController();

		try {
			const conversation = query({
				prompt: params.prompt,
				options: {
					systemPrompt: params.systemPrompt,
					abortController,
					resume: params.resume,
					maxTurns: params.maxTurns,
					cwd: params.cwd,
					model: params.model,
					effort: params.effort as
						| "low"
						| "medium"
						| "high"
						| "max"
						| undefined,
					permissionMode: "bypassPermissions",
					allowDangerouslySkipPermissions: true,
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
				} else if (event.type === "result") {
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
