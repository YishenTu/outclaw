import type { FacadeEvent, UsageInfo } from "../../common/protocol.ts";
import { extractClaudeSkills } from "./claude-skill-probe.ts";
import {
	applyAuthoritativeClaudeModelUsage,
	type ClaudeModelUsageEntry,
	extractClaudeAssistantUsage,
} from "./claude-usage.ts";

interface ClaudeStreamConversation extends AsyncIterable<unknown> {
	supportedCommands(): Promise<{ name: string; description: string }[]>;
}

interface ClaudeStreamNormalizerOptions {
	conversation: ClaudeStreamConversation;
	model?: string;
	onSkills?: (skills: Awaited<ReturnType<typeof extractClaudeSkills>>) => void;
	stream?: boolean;
}

interface ClaudeSdkEvent {
	type?: string;
	subtype?: string;
	status?: string | null;
	skills?: string[];
	parent_tool_use_id?: string | null;
	message?: {
		content?: Array<{
			type?: string;
			text?: string;
			thinking?: string;
		}>;
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
			cache_creation_input_tokens?: number;
			cache_read_input_tokens?: number;
		};
	};
	event?: {
		type?: string;
		delta?: {
			type?: string;
			text?: string;
			thinking?: string;
		};
	};
	session_id?: string;
	duration_ms?: number;
	total_cost_usd?: number;
	modelUsage?: Record<string, ClaudeModelUsageEntry>;
}

export async function* normalizeClaudeStream(
	options: ClaudeStreamNormalizerOptions,
): AsyncIterable<FacadeEvent> {
	let emittedAssistantText = "";
	let streamedThinkingText = "";
	let needsSeparator = false;
	let pendingUsage: UsageInfo | undefined;

	for await (const sdkEvent of options.conversation) {
		const event = sdkEvent as ClaudeSdkEvent;

		if (event.type === "system" && event.subtype === "init") {
			if (event.session_id) {
				yield {
					type: "session_initialized",
					sessionId: event.session_id,
				};
			}
			options.onSkills?.(
				await extractClaudeSkills(options.conversation, {
					skills: event.skills,
				}),
			);
			continue;
		}

		if (event.type === "system" && event.subtype === "status") {
			if (event.status === "compacting") {
				yield { type: "compacting_started" };
			} else if (event.status === null) {
				yield { type: "compacting_finished" };
			}
			continue;
		}

		if (event.type === "stream_event") {
			const raw = event.event;
			if (
				raw?.type === "content_block_delta" &&
				raw.delta?.type === "thinking_delta"
			) {
				const thinking = raw.delta.thinking ?? "";
				streamedThinkingText += thinking;
				yield { type: "thinking", text: thinking };
			}
			if (
				raw?.type === "content_block_delta" &&
				raw.delta?.type === "text_delta"
			) {
				if (needsSeparator) {
					emittedAssistantText += "\n\n";
					yield { type: "text", text: "\n\n" };
					needsSeparator = false;
				}
				const text = raw.delta.text ?? "";
				emittedAssistantText += text;
				yield { type: "text", text };
			}
			continue;
		}

		if (event.type === "assistant") {
			const nextThinking = extractThinkingText(event);
			const thinking = normalizeAssistantText(
				nextThinking,
				streamedThinkingText,
				options.stream,
			);
			if (thinking) {
				yield { type: "thinking", text: thinking };
			}
			streamedThinkingText = "";

			const nextText = extractAssistantText(event);
			const text = normalizeAssistantText(
				nextText,
				emittedAssistantText,
				options.stream,
			);
			if (text) {
				const separator = needsSeparator ? "\n\n" : "";
				emittedAssistantText += separator + text;
				yield { type: "text", text: separator + text };
				needsSeparator = false;
			}
			if (emittedAssistantText) {
				needsSeparator = true;
			}

			if (event.parent_tool_use_id === null) {
				pendingUsage = extractClaudeAssistantUsage(event, options.model);
			}
		}

		if (event.type === "result") {
			yield {
				type: "done",
				sessionId: event.session_id as string,
				durationMs: event.duration_ms as number,
				costUsd: event.total_cost_usd,
				usage: applyAuthoritativeClaudeModelUsage(
					pendingUsage,
					event,
					options.model,
				),
			};
		}
	}
}

function extractThinkingText(event: {
	message?: {
		content?: Array<{
			type?: string;
			thinking?: string;
		}>;
	};
}): string {
	return (
		event.message?.content
			?.filter((block) => block.type === "thinking")
			.map((block) => block.thinking ?? "")
			.join("") ?? ""
	);
}

function extractAssistantText(event: {
	message?: {
		content?: Array<{
			type?: string;
			text?: string;
		}>;
	};
}): string {
	return (
		event.message?.content
			?.filter((block) => block.type === "text")
			.map((block) => block.text ?? "")
			.join("") ?? ""
	);
}

function normalizeAssistantText(
	text: string,
	emittedText: string,
	stream: boolean | undefined,
): string | undefined {
	if (!text) {
		return undefined;
	}

	if (stream === false || emittedText === "") {
		return text;
	}

	if (!text.startsWith(emittedText)) {
		return undefined;
	}

	const remainder = text.slice(emittedText.length);
	return remainder || undefined;
}
