import type { FacadeEvent, UsageInfo } from "../../../common/protocol.ts";
import type {
	CodexServerNotification,
	CodexThreadTokenUsage,
	CodexTurn,
	CodexTurnError,
} from "./types.ts";

interface NormalizeCodexTurnOptions {
	notifications: AsyncIterable<CodexServerNotification>;
	threadId: string;
	turnId: string;
	sessionId: string;
	startedAtMs: number;
}

export async function* normalizeCodexTurnNotifications(
	options: NormalizeCodexTurnOptions,
): AsyncIterable<FacadeEvent> {
	let pendingUsage: UsageInfo | undefined;

	for await (const notification of options.notifications) {
		if (
			!isNotificationForTurn(notification, options.threadId, options.turnId)
		) {
			continue;
		}

		switch (notification.method) {
			case "item/agentMessage/delta": {
				const delta = readString(notification.params, "delta");
				if (delta) {
					yield {
						type: "text",
						text: delta,
						sessionId: options.sessionId,
					};
				}
				break;
			}
			case "item/reasoning/textDelta":
			case "item/reasoning/summaryTextDelta": {
				const delta = readString(notification.params, "delta");
				if (delta) {
					yield {
						type: "thinking",
						text: delta,
						sessionId: options.sessionId,
					};
				}
				break;
			}
			case "thread/tokenUsage/updated": {
				const usage = readUsage(notification.params);
				if (usage) {
					pendingUsage = usage;
				}
				break;
			}
			case "error": {
				const message = readErrorMessage(notification.params);
				if (message) {
					yield {
						type: "error",
						message,
						sessionId: options.sessionId,
					};
				}
				break;
			}
			case "turn/completed": {
				const turn = readTurn(notification.params);
				yield {
					type: "done",
					sessionId: options.sessionId,
					durationMs: turn?.durationMs ?? Date.now() - options.startedAtMs,
					usage: pendingUsage,
				};
				return;
			}
			default:
				break;
		}
	}
}

function isNotificationForTurn(
	notification: CodexServerNotification,
	threadId: string,
	turnId: string,
): boolean {
	const params = asRecord(notification.params);
	if (!params || params.threadId !== threadId) {
		return false;
	}

	if (notification.method === "turn/completed") {
		return readTurn(params)?.id === turnId;
	}

	return params.turnId === turnId;
}

function readUsage(params: unknown): UsageInfo | undefined {
	const record = asRecord(params);
	const tokenUsage = record?.tokenUsage as CodexThreadTokenUsage | undefined;
	const last = tokenUsage?.last;
	if (!last) {
		return undefined;
	}

	const contextWindow = tokenUsage.modelContextWindow ?? 0;
	const contextTokens = last.inputTokens + last.outputTokens;
	return {
		inputTokens: last.inputTokens,
		outputTokens: last.outputTokens,
		cacheCreationTokens: 0,
		cacheReadTokens: last.cachedInputTokens,
		contextWindow,
		maxOutputTokens: 0,
		contextTokens,
		percentage:
			contextWindow > 0
				? Math.min(100, (contextTokens / contextWindow) * 100)
				: 0,
	};
}

function readTurn(params: unknown): CodexTurn | undefined {
	const record = asRecord(params);
	const turn = asRecord(record?.turn);
	if (!turn || typeof turn.id !== "string") {
		return undefined;
	}

	return {
		id: turn.id,
		durationMs:
			typeof turn.durationMs === "number" ? turn.durationMs : undefined,
		status: typeof turn.status === "string" ? turn.status : undefined,
		error: readTurnError(turn.error),
	};
}

function readTurnError(value: unknown): CodexTurnError | null {
	const record = asRecord(value);
	if (!record) {
		return null;
	}

	return {
		message: typeof record.message === "string" ? record.message : undefined,
		codexErrorInfo: record.codexErrorInfo,
		additionalDetails:
			typeof record.additionalDetails === "string"
				? record.additionalDetails
				: null,
	};
}

function readErrorMessage(params: unknown): string | undefined {
	const record = asRecord(params);
	const error = readTurnError(record?.error);
	if (error?.message) {
		return error.message;
	}
	return typeof record?.message === "string" ? record.message : undefined;
}

function readString(params: unknown, key: string): string | undefined {
	const record = asRecord(params);
	const value = record?.[key];
	return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}
