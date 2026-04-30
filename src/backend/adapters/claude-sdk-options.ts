import { contextWindowForResolvedModel } from "../../common/models.ts";
import type { RunParams } from "../../common/protocol.ts";

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
}

export function buildClaudeSdkOptions(
	params: RunParams,
	abortController: AbortController,
	autoCompact: boolean,
): ClaudeSdkRunOptions {
	return {
		systemPrompt: params.systemPrompt,
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
		model: params.model,
		effort: params.effort as ClaudeEffort | undefined,
		permissionMode: "bypassPermissions",
		allowDangerouslySkipPermissions: true,
		includePartialMessages: params.stream ?? true,
		settings: buildClaudeAutoCompactSettings(params.model, autoCompact),
		tools: CLAUDE_TOOLS,
	};
}

function buildClaudeAutoCompactSettings(
	model: string | undefined,
	autoCompact: boolean,
): { autoCompactWindow: number } | undefined {
	if (!autoCompact || !model) return undefined;
	const contextWindow = contextWindowForResolvedModel(model);
	if (!contextWindow) return undefined;
	return { autoCompactWindow: Math.round(contextWindow * 0.8) };
}
