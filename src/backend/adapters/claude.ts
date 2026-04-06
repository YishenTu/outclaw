import { query } from "@anthropic-ai/claude-agent-sdk";
import {
	extractError,
	type Facade,
	type FacadeEvent,
	type RunParams,
} from "../../common/protocol.ts";

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
					permissionMode: "bypassPermissions",
					allowDangerouslySkipPermissions: true,
				},
			});

			for await (const event of conversation) {
				if (event.type === "assistant") {
					for (const block of event.message.content) {
						if (block.type === "text" && block.text) {
							yield { type: "text", text: block.text };
						}
					}
				} else if (event.type === "result") {
					yield {
						type: "done",
						sessionId: event.session_id,
						durationMs: event.duration_ms,
						costUsd: event.total_cost_usd,
					};
				}
			}
		} catch (err) {
			yield { type: "error", message: extractError(err) };
		}
	}
}
