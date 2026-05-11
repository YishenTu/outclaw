import type {
	FacadeEvent,
	FileChange,
	FileChangeKind,
	UsageInfo,
} from "../../../common/protocol.ts";
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
			case "item/started": {
				const event = readCommandExecutionStarted(
					notification.params,
					options.sessionId,
				);
				if (event) {
					yield event;
				}
				break;
			}
			case "item/completed": {
				const command = readCommandExecutionCompleted(
					notification.params,
					options.sessionId,
				);
				if (command) {
					yield command;
					break;
				}
				const fileChange = readFileChangeApplied(
					notification.params,
					options.sessionId,
				);
				if (fileChange) {
					yield fileChange;
				}
				break;
			}
			case "thread/tokenUsage/updated": {
				const usage = readUsage(notification.params);
				if (usage) {
					pendingUsage = usage;
					yield {
						type: "usage_updated",
						usage,
						sessionId: options.sessionId,
					};
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

function readCommandExecutionStarted(
	params: unknown,
	sessionId: string,
): FacadeEvent | undefined {
	const item = asRecord(asRecord(params)?.item);
	if (!item || item.type !== "commandExecution") {
		return undefined;
	}
	const callId = typeof item.id === "string" ? item.id : undefined;
	if (!callId) {
		return undefined;
	}
	const command = resolveCommandText(item);
	const cwd = typeof item.cwd === "string" ? item.cwd : undefined;
	return {
		type: "command_execution_started",
		callId,
		command,
		...(cwd ? { cwd } : {}),
		sessionId,
	};
}

function readCommandExecutionCompleted(
	params: unknown,
	sessionId: string,
): FacadeEvent | undefined {
	const item = asRecord(asRecord(params)?.item);
	if (!item || item.type !== "commandExecution") {
		return undefined;
	}
	const callId = typeof item.id === "string" ? item.id : undefined;
	if (!callId) {
		return undefined;
	}
	const exitCode =
		typeof item.exitCode === "number" ? item.exitCode : undefined;
	const durationMs =
		typeof item.durationMs === "number" ? item.durationMs : undefined;
	const output =
		typeof item.aggregatedOutput === "string"
			? item.aggregatedOutput
			: undefined;
	return {
		type: "command_execution_completed",
		callId,
		...(exitCode !== undefined ? { exitCode } : {}),
		...(durationMs !== undefined ? { durationMs } : {}),
		...(output !== undefined ? { output } : {}),
		sessionId,
	};
}

function resolveCommandText(item: Record<string, unknown>): string {
	const actions = Array.isArray(item.commandActions) ? item.commandActions : [];
	const firstAction = asRecord(actions[0]);
	const cooked =
		firstAction && typeof firstAction.command === "string"
			? firstAction.command
			: undefined;
	if (cooked) {
		return cooked;
	}
	return typeof item.command === "string" ? item.command : "";
}

function readFileChangeApplied(
	params: unknown,
	sessionId: string,
): FacadeEvent | undefined {
	const item = asRecord(asRecord(params)?.item);
	if (!item || item.type !== "fileChange") {
		return undefined;
	}
	const callId = typeof item.id === "string" ? item.id : undefined;
	if (!callId) {
		return undefined;
	}
	const rawChanges = Array.isArray(item.changes) ? item.changes : [];
	const changes = rawChanges
		.map((entry) => normalizeFileChange(entry))
		.filter((change): change is FileChange => change !== undefined);
	if (changes.length === 0) {
		return undefined;
	}
	return {
		type: "file_change_applied",
		callId,
		changes,
		sessionId,
	};
}

function normalizeFileChange(value: unknown): FileChange | undefined {
	const record = asRecord(value);
	if (!record || typeof record.path !== "string") {
		return undefined;
	}
	const kindRecord = asRecord(record.kind);
	const rawKind =
		kindRecord && typeof kindRecord.type === "string"
			? kindRecord.type
			: undefined;
	const kind = mapFileChangeKind(rawKind);
	if (!kind) {
		return undefined;
	}
	const diff = typeof record.diff === "string" ? record.diff : undefined;
	const movePath =
		kindRecord && typeof kindRecord.move_path === "string"
			? kindRecord.move_path
			: undefined;
	return {
		path: record.path,
		kind,
		...(diff !== undefined ? { diff } : {}),
		...(movePath !== undefined ? { movePath } : {}),
	};
}

function mapFileChangeKind(
	value: string | undefined,
): FileChangeKind | undefined {
	switch (value) {
		case "add":
		case "update":
		case "delete":
		case "move":
			return value;
		default:
			return undefined;
	}
}
