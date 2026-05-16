import type { HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import type { RunParams } from "../../../common/protocol.ts";
import { blockDotClaudeHookMatcher } from "./block-dotclaude-hook.ts";
import {
	claudeContextWindowForModel,
	resolveClaudeModelForSdk,
} from "./models.ts";

const CLAUDE_TOOLS = [
	"Bash",
	"Read",
	"Write",
	"Edit",
	"Glob",
	"Grep",
	"WebSearch",
	"WebFetch",
	"Skill",
];

type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeSdkRunOptions {
	systemPrompt?: string;
	abortController: AbortController;
	resume?: string;
	sessionId?: string;
	cwd?: string;
	env?: Record<string, string>;
	model?: string;
	effort?: ClaudeEffort;
	permissionMode: "bypassPermissions";
	allowDangerouslySkipPermissions: true;
	includePartialMessages: boolean;
	settings?: { autoCompactWindow: number };
	tools: string[];
	hooks: { PreToolUse: HookCallbackMatcher[] };
}

export function buildClaudeSdkOptions(
	params: RunParams,
	abortController: AbortController,
	autoCompact: boolean,
): ClaudeSdkRunOptions {
	const systemPrompt =
		params.instructionPolicy?.mode === "runtime_constructed"
			? params.instructionPolicy.systemPrompt
			: undefined;
	return {
		systemPrompt,
		abortController,
		resume: params.resume,
		sessionId: params.sessionId,
		cwd: params.cwd,
		// The SDK uses options.env as-is for the claude-code subprocess spawn.
		// Merge with process.env so PATH/HOME/etc survive.
		env: params.sessionEnv
			? {
					...(process.env as Record<string, string>),
					...params.sessionEnv,
				}
			: undefined,
		model: resolveClaudeModelForSdk(params.model),
		effort: params.effort as ClaudeEffort | undefined,
		permissionMode: "bypassPermissions",
		allowDangerouslySkipPermissions: true,
		includePartialMessages: params.stream ?? true,
		settings: buildClaudeAutoCompactSettings(params.model, autoCompact),
		tools: params.executionMode === "read_only" ? [] : CLAUDE_TOOLS,
		hooks: { PreToolUse: [blockDotClaudeHookMatcher] },
	};
}

function buildClaudeAutoCompactSettings(
	model: string | undefined,
	autoCompact: boolean,
): { autoCompactWindow: number } | undefined {
	if (!autoCompact || !model) return undefined;
	const contextWindow = claudeContextWindowForModel(model);
	if (!contextWindow) return undefined;
	return { autoCompactWindow: Math.round(contextWindow * 0.8) };
}
