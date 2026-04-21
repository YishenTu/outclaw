import { getAgentNameValidationError } from "../../../common/agent-name.ts";

export type AgentOnboardingMode = "quick" | "full";
export type AgentOnboardingScope = "agent" | "agent+telegram";
export type AgentOnboardingChoice = "yes" | "no";
export type AgentOnboardingStep =
	| "mode"
	| "name"
	| "token"
	| "users"
	| "secure"
	| "lan"
	| "confirm";

export interface AgentOnboardingDraft {
	allowedUsers: string;
	botToken: string;
	enableLan: AgentOnboardingChoice | undefined;
	mode: AgentOnboardingMode | undefined;
	name: string;
	secureTelegramConfig: AgentOnboardingChoice | undefined;
}

export interface AgentOnboardingSubmission {
	allowedUsers?: number[];
	botToken?: string;
	enableLan: boolean;
	mode: AgentOnboardingMode;
	name: string;
	scope: AgentOnboardingScope;
	secureTelegramConfig?: boolean;
}

export function createAgentOnboardingDraft(): AgentOnboardingDraft {
	return {
		allowedUsers: "",
		botToken: "",
		enableLan: undefined,
		mode: undefined,
		name: "",
		secureTelegramConfig: undefined,
	};
}

export function resolveAgentOnboardingSteps(
	draft: AgentOnboardingDraft,
): AgentOnboardingStep[] {
	const steps: AgentOnboardingStep[] = ["mode", "name"];
	if (resolveAgentOnboardingScope(draft) === "agent+telegram") {
		steps.push("token", "users", "secure");
	}
	steps.push("lan", "confirm");
	return steps;
}

export function resolveAgentOnboardingScope(
	draft: AgentOnboardingDraft,
): AgentOnboardingScope {
	return draft.mode === "full" ? "agent+telegram" : "agent";
}

export function validateAgentOnboardingName(value: string): string | undefined {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return "name is required";
	}

	return getAgentNameValidationError(trimmed);
}

export function validateTelegramToken(value: string): string | undefined {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return "token is required";
	}
	if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
		return "doesn't look like a Telegram bot token (e.g. 123456:AA...)";
	}
	return undefined;
}

export function validateAllowedUsers(value: string): string | undefined {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return undefined;
	}

	const entries = trimmed.split(",").map((item) => item.trim());
	if (entries.some((item) => !/^-?\d+$/.test(item))) {
		return "use comma-separated integers, e.g. 12345, 67890";
	}
	return undefined;
}

export function parseAllowedUsers(value: string): number[] {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return [];
	}

	return trimmed
		.split(",")
		.map((item) => Number(item.trim()))
		.filter((item) => Number.isInteger(item));
}

export function buildAgentOnboardingSubmission(
	draft: AgentOnboardingDraft,
): AgentOnboardingSubmission {
	const scope = resolveAgentOnboardingScope(draft);
	return {
		...(scope === "agent+telegram"
			? {
					allowedUsers: parseAllowedUsers(draft.allowedUsers),
					botToken: draft.botToken.trim(),
					secureTelegramConfig: draft.secureTelegramConfig === "yes",
				}
			: {}),
		enableLan: draft.enableLan === "yes",
		mode: draft.mode ?? "quick",
		name: draft.name.trim(),
		scope,
	};
}
