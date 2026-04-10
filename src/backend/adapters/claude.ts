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
	type SkillInfo,
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
	private skills: SkillInfo[] = [];

	async getSkills(cwd?: string): Promise<SkillInfo[]> {
		if (this.skills.length > 0) {
			return this.skills;
		}
		return this.probeSkills(cwd);
	}

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		const abortController = params.abortController ?? new AbortController();
		let emittedAssistantText = "";

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
					permissionMode: "bypassPermissions",
					allowDangerouslySkipPermissions: true,
					includePartialMessages: params.stream ?? true,
					tools: [
						"Bash",
						"Read",
						"Write",
						"Edit",
						"Glob",
						"Grep",
						"WebSearch",
						"WebFetch",
						"Skill",
					],
				},
			});

			for await (const event of conversation) {
				if (event.type === "system" && event.subtype === "init") {
					this.skills = await extractSkills(
						conversation,
						event as { skills?: string[] },
					);
					continue;
				}

				if (event.type === "stream_event") {
					const raw = event.event;
					if (
						raw.type === "content_block_delta" &&
						raw.delta.type === "text_delta"
					) {
						emittedAssistantText += raw.delta.text;
						yield { type: "text", text: raw.delta.text };
					}
					continue;
				}

				if (event.type === "assistant") {
					const nextText = extractAssistantText(event);
					const text = normalizeAssistantText(
						nextText,
						emittedAssistantText,
						params.stream,
					);
					if (text) {
						emittedAssistantText += text;
						yield { type: "text", text };
					}
				}

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

	private async probeSkills(cwd?: string): Promise<SkillInfo[]> {
		const abortController = new AbortController();
		let sessionId: string | undefined;

		try {
			const conversation = query({
				prompt: "",
				options: {
					abortController,
					cwd,
					permissionMode: "bypassPermissions",
					allowDangerouslySkipPermissions: true,
				},
			});

			for await (const event of conversation) {
				if (event.type === "system" && event.subtype === "init") {
					sessionId = (event as Record<string, unknown>).session_id as
						| string
						| undefined;
					this.skills = await extractSkills(
						conversation,
						event as { skills?: string[] },
					);
					abortController.abort();
					break;
				}
			}
		} catch {
			// Probe is best-effort; swallow abort errors.
		}

		if (sessionId) {
			await cleanupProbeSession(cwd, sessionId);
		}
		return this.skills;
	}
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

async function extractSkills(
	conversation: {
		supportedCommands(): Promise<{ name: string; description: string }[]>;
	},
	initEvent: { skills?: string[] },
): Promise<SkillInfo[]> {
	const skillNames = new Set(initEvent.skills ?? []);
	if (skillNames.size === 0) return [];

	try {
		const commands = await conversation.supportedCommands();
		return commands
			.filter((c) => skillNames.has(c.name))
			.map((c) => ({ name: c.name, description: c.description }));
	} catch {
		return [...skillNames].map((name) => ({ name, description: "" }));
	}
}

async function cleanupProbeSession(
	cwd: string | undefined,
	sessionId: string,
): Promise<void> {
	const dir = cwd ?? process.cwd();
	const encodedCwd = dir.replaceAll("/", "-");
	const path = `${process.env.HOME}/.claude/projects/${encodedCwd}/${sessionId}.jsonl`;

	// SDK writes the JSONL asynchronously after abort
	await new Promise((r) => setTimeout(r, 500));

	try {
		const { unlinkSync } = await import("node:fs");
		unlinkSync(path);
	} catch {
		// Cleanup is best-effort.
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
