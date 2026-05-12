import type {
	FacadeEvent,
	FileChange,
	FileChangeKind,
	SubagentToolAgentState,
	ToolCallDetail,
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
	let terminalError = false;
	const finalAssistantMessageIds = new Set<string>();
	const rawCommandStarts = new Set<string>();
	const rawCommandOutputs = new Map<string, string>();
	const rawToolKindsByCallId = new Map<string, string>();
	const completedCommands = new Set<string>();

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
			case "rawResponseItem/completed": {
				const events = readRawResponseItemCompleted(
					notification.params,
					options.sessionId,
					rawCommandStarts,
					rawCommandOutputs,
					rawToolKindsByCallId,
				);
				for (const event of events) {
					yield event;
				}
				break;
			}
			case "item/started": {
				const finalAssistantMessageId = readFinalAssistantMessageId(
					notification.params,
				);
				if (finalAssistantMessageId) {
					finalAssistantMessageIds.add(finalAssistantMessageId);
				}
				const event = readItemStarted(notification.params, options.sessionId);
				if (event) {
					if (
						event.type === "command_execution_started" &&
						rawCommandStarts.has(event.callId)
					) {
						break;
					}
					yield event;
				}
				break;
			}
			case "item/commandExecution/outputDelta": {
				const event = readCommandExecutionOutputDelta(
					notification.params,
					options.sessionId,
				);
				if (event) {
					yield event;
				}
				break;
			}
			case "item/completed": {
				if (
					isFinalAssistantMessageCompleted(
						notification.params,
						finalAssistantMessageIds,
					)
				) {
					yield {
						type: "done",
						sessionId: options.sessionId,
						durationMs: Date.now() - options.startedAtMs,
						...(pendingUsage ? { usage: pendingUsage } : {}),
					};
					return;
				}
				const callId = readItemCallId(notification.params);
				const rawOutput = callId ? rawCommandOutputs.get(callId) : undefined;
				const event = readItemCompleted(
					notification.params,
					options.sessionId,
					rawOutput,
				);
				if (event) {
					if (event.type === "command_execution_completed") {
						completedCommands.add(event.callId);
						rawCommandOutputs.delete(event.callId);
					}
					yield event;
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
					terminalError = true;
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
				if (terminalError) {
					return;
				}
				const failureMessage = readTurnFailureMessage(turn);
				if (failureMessage) {
					yield {
						type: "error",
						message: failureMessage,
						sessionId: options.sessionId,
					};
					return;
				}
				for (const [callId, output] of rawCommandOutputs) {
					if (completedCommands.has(callId)) {
						continue;
					}
					yield {
						type: "command_execution_completed",
						callId,
						output,
						sessionId: options.sessionId,
					};
				}
				rawCommandOutputs.clear();
				yield {
					type: "done",
					sessionId: options.sessionId,
					durationMs: turn?.durationMs ?? Date.now() - options.startedAtMs,
					...(pendingUsage ? { usage: pendingUsage } : {}),
				};
				return;
			}
			default:
				break;
		}
	}
}

export function normalizeCodexJsonlEvents(
	content: string,
	options: { sessionId: string },
): FacadeEvent[] {
	const events: FacadeEvent[] = [];
	const commandCallIds = new Set<string>();
	const toolKindsByCallId = new Map<string, string>();

	for (const line of content.split("\n")) {
		if (!line.trim()) {
			continue;
		}
		const row = asRecord(JSON.parse(line));
		const payload = asRecord(row?.payload);
		if (!row || !payload) {
			continue;
		}
		const rowType = typeof row.type === "string" ? row.type : undefined;
		const payloadType =
			typeof payload.type === "string" ? payload.type : undefined;

		if (rowType === "response_item") {
			switch (payloadType) {
				case "message": {
					if (payload.role !== "assistant") {
						break;
					}
					const text = readContentText(payload.content);
					if (text) {
						events.push({
							type: "text",
							text,
							sessionId: options.sessionId,
						});
					}
					break;
				}
				case "reasoning": {
					const text = readReasoningText(payload);
					if (text) {
						events.push({
							type: "thinking",
							text,
							sessionId: options.sessionId,
						});
					}
					break;
				}
				case "function_call": {
					const name =
						typeof payload.name === "string" ? payload.name : undefined;
					if (name === "exec_command") {
						const event = readRawCommandExecutionStarted(
							payload,
							options.sessionId,
						);
						if (event?.type === "command_execution_started") {
							commandCallIds.add(event.callId);
							events.push(event);
						}
						break;
					}
					for (const event of readRawGenericToolStarted(
						payload,
						options.sessionId,
					)) {
						if (event.type === "tool_call_started") {
							toolKindsByCallId.set(event.callId, event.toolKind);
						}
						events.push(event);
					}
					break;
				}
				case "function_call_output": {
					const callId =
						typeof payload.call_id === "string" ? payload.call_id : undefined;
					if (!callId) {
						break;
					}
					if (commandCallIds.has(callId)) {
						events.push({
							type: "command_execution_completed",
							callId,
							output: normalizeFunctionOutput(payload.output),
							sessionId: options.sessionId,
						});
						break;
					}
					const toolKind = toolKindsByCallId.get(callId);
					if (toolKind) {
						events.push({
							type: "tool_call_completed",
							callId,
							toolKind,
							details: [
								{
									label: "output",
									value: normalizeFunctionOutput(payload.output),
								},
							],
							sessionId: options.sessionId,
						});
					}
					break;
				}
				case "custom_tool_call": {
					if (payload.name === "apply_patch") {
						break;
					}
					for (const event of readRawGenericToolStarted(
						payload,
						options.sessionId,
					)) {
						if (event.type === "tool_call_started") {
							toolKindsByCallId.set(event.callId, event.toolKind);
						}
						events.push(event);
					}
					break;
				}
				case "custom_tool_call_output": {
					if (payload.name === "apply_patch") {
						break;
					}
					for (const event of readRawGenericToolCompleted(
						payload,
						options.sessionId,
					)) {
						events.push(event);
					}
					break;
				}
				default:
					break;
			}
			continue;
		}

		if (rowType === "event_msg") {
			switch (payloadType) {
				case "patch_apply_end": {
					const event = readJsonlPatchApplyEnd(payload, options.sessionId);
					if (event) {
						events.push(event);
					}
					break;
				}
				case "web_search_end": {
					const event = readJsonlWebSearchEnd(payload, options.sessionId);
					if (event) {
						events.push(event);
					}
					break;
				}
				default:
					break;
			}
		}
	}

	return events;
}

function readTurnFailureMessage(
	turn: CodexTurn | undefined,
): string | undefined {
	if (!turn) {
		return undefined;
	}
	if (turn.error?.message) {
		return turn.error.message;
	}
	if (turn.error?.additionalDetails) {
		return turn.error.additionalDetails;
	}
	if (turn.status && turn.status !== "completed") {
		return `Codex turn ended with status: ${turn.status}`;
	}
	return undefined;
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

function readRawResponseItemCompleted(
	params: unknown,
	sessionId: string,
	rawCommandStarts: Set<string>,
	rawCommandOutputs: Map<string, string>,
	rawToolKindsByCallId: Map<string, string>,
): FacadeEvent[] {
	const item = asRecord(asRecord(params)?.item);
	const itemType = typeof item?.type === "string" ? item.type : undefined;
	if (!item || !itemType) {
		return [];
	}

	if (itemType === "function_call") {
		const name = typeof item.name === "string" ? item.name : undefined;
		if (name === "exec_command") {
			const event = readRawCommandExecutionStarted(item, sessionId);
			if (!event) {
				return [];
			}
			rawCommandStarts.add(event.callId);
			return [event];
		}
		const events = readRawGenericToolStarted(item, sessionId);
		for (const event of events) {
			if (event.type === "tool_call_started") {
				rawToolKindsByCallId.set(event.callId, event.toolKind);
			}
		}
		return events;
	}

	if (itemType === "function_call_output") {
		const callId = typeof item.call_id === "string" ? item.call_id : undefined;
		if (!callId) {
			return [];
		}
		const output = normalizeFunctionOutput(item.output);
		if (rawCommandStarts.has(callId)) {
			rawCommandOutputs.set(callId, output);
			return [];
		}
		const toolKind = rawToolKindsByCallId.get(callId);
		if (!toolKind) {
			return [];
		}
		rawToolKindsByCallId.delete(callId);
		return [
			{
				type: "tool_call_completed",
				callId,
				toolKind,
				details: [{ label: "output", value: output }],
				sessionId,
			},
		];
	}

	if (itemType === "custom_tool_call") {
		if (item.name === "apply_patch") {
			return [];
		}
		return readRawGenericToolStarted(item, sessionId);
	}

	if (itemType === "custom_tool_call_output") {
		if (item.name === "apply_patch") {
			return [];
		}
		return readRawGenericToolCompleted(item, sessionId);
	}

	return [];
}

function readRawCommandExecutionStarted(
	item: Record<string, unknown>,
	sessionId: string,
): Extract<FacadeEvent, { type: "command_execution_started" }> | undefined {
	const callId = typeof item.call_id === "string" ? item.call_id : undefined;
	if (!callId) {
		return undefined;
	}
	const args = parseJsonObject(item.arguments);
	const command =
		typeof args?.cmd === "string"
			? args.cmd
			: typeof args?.command === "string"
				? args.command
				: "";
	const cwd =
		typeof args?.workdir === "string"
			? args.workdir
			: typeof args?.cwd === "string"
				? args.cwd
				: undefined;
	return {
		type: "command_execution_started",
		callId,
		command,
		...(cwd ? { cwd } : {}),
		sessionId,
	};
}

function readRawGenericToolStarted(
	item: Record<string, unknown>,
	sessionId: string,
): FacadeEvent[] {
	const callId = typeof item.call_id === "string" ? item.call_id : undefined;
	const toolKind =
		typeof item.name === "string"
			? item.name
			: typeof item.type === "string"
				? item.type
				: undefined;
	if (!callId || !toolKind) {
		return [];
	}
	return [
		{
			type: "tool_call_started",
			callId,
			toolKind,
			...readRawGenericToolDetails(item),
			sessionId,
		},
	];
}

function readRawGenericToolCompleted(
	item: Record<string, unknown>,
	sessionId: string,
): FacadeEvent[] {
	const callId = typeof item.call_id === "string" ? item.call_id : undefined;
	const toolKind =
		typeof item.name === "string"
			? item.name
			: typeof item.type === "string"
				? item.type
				: undefined;
	if (!callId || !toolKind) {
		return [];
	}
	const status = typeof item.status === "string" ? item.status : undefined;
	return [
		{
			type: "tool_call_completed",
			callId,
			toolKind,
			...(status ? { status } : {}),
			...readRawGenericToolDetails(item),
			sessionId,
		},
	];
}

function readCommandExecutionOutputDelta(
	params: unknown,
	sessionId: string,
): FacadeEvent | undefined {
	const record = asRecord(params);
	const callId = typeof record?.itemId === "string" ? record.itemId : undefined;
	const output = typeof record?.delta === "string" ? record.delta : undefined;
	if (!callId || !output) {
		return undefined;
	}
	return {
		type: "command_execution_output",
		callId,
		output,
		sessionId,
	};
}

function readItemCallId(params: unknown): string | undefined {
	const item = asRecord(asRecord(params)?.item);
	return typeof item?.id === "string" ? item.id : undefined;
}

function readContentText(value: unknown): string {
	if (!Array.isArray(value)) {
		return "";
	}
	return value
		.map((entry) => {
			const record = asRecord(entry);
			return typeof record?.text === "string" ? record.text : "";
		})
		.join("");
}

function readReasoningText(item: Record<string, unknown>): string {
	const contentText = readContentText(item.content);
	if (contentText) {
		return contentText;
	}
	return readContentText(item.summary);
}

function readJsonlPatchApplyEnd(
	payload: Record<string, unknown>,
	sessionId: string,
): FacadeEvent | undefined {
	const callId =
		typeof payload.call_id === "string" ? payload.call_id : undefined;
	const changesRecord = asRecord(payload.changes);
	if (!callId || !changesRecord) {
		return undefined;
	}
	const changes: FileChange[] = [];
	for (const [path, rawChange] of Object.entries(changesRecord)) {
		const change = asRecord(rawChange);
		if (!change) {
			continue;
		}
		const kind = mapFileChangeKind(
			typeof change.type === "string" ? change.type : undefined,
		);
		if (!kind) {
			continue;
		}
		const diff =
			typeof change.unified_diff === "string"
				? change.unified_diff
				: typeof change.content === "string"
					? change.content
					: undefined;
		const movePath =
			typeof change.move_path === "string" ? change.move_path : undefined;
		changes.push({
			path,
			kind,
			...(diff !== undefined ? { diff } : {}),
			...(movePath !== undefined ? { movePath } : {}),
		});
	}
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

function readJsonlWebSearchEnd(
	payload: Record<string, unknown>,
	sessionId: string,
): FacadeEvent | undefined {
	const callId =
		typeof payload.call_id === "string" ? payload.call_id : undefined;
	if (!callId) {
		return undefined;
	}
	const action = asRecord(payload.action);
	const query =
		(typeof payload.query === "string" && payload.query
			? payload.query
			: undefined) ??
		(typeof action?.query === "string" && action.query
			? (action.query as string)
			: undefined);
	const queries = Array.isArray(action?.queries)
		? (action.queries as unknown[]).filter(
				(value): value is string => typeof value === "string",
			)
		: undefined;
	return {
		type: "web_search_completed",
		callId,
		...(query ? { query } : {}),
		...(queries && queries.length > 0 ? { queries } : {}),
		sessionId,
	};
}

function readFinalAssistantMessageId(params: unknown): string | undefined {
	const item = asRecord(asRecord(params)?.item);
	if (item?.type !== "agentMessage" || item.phase !== "final_answer") {
		return undefined;
	}
	return typeof item.id === "string" ? item.id : undefined;
}

function isFinalAssistantMessageCompleted(
	params: unknown,
	finalAssistantMessageIds: Set<string>,
): boolean {
	const item = asRecord(asRecord(params)?.item);
	if (item?.type !== "agentMessage") {
		return false;
	}
	if (item.phase === "final_answer") {
		return true;
	}
	const itemId = typeof item.id === "string" ? item.id : undefined;
	const isFinal = itemId !== undefined && finalAssistantMessageIds.has(itemId);
	if (itemId) {
		finalAssistantMessageIds.delete(itemId);
	}
	return isFinal;
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

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	try {
		return asRecord(JSON.parse(value));
	} catch {
		return undefined;
	}
}

function normalizeFunctionOutput(value: unknown): string {
	if (typeof value === "string") {
		return extractCommandOutput(value);
	}
	if (Array.isArray(value)) {
		const text = value
			.map((entry) => {
				const record = asRecord(entry);
				return typeof record?.text === "string" ? record.text : "";
			})
			.join("");
		return text || JSON.stringify(value);
	}
	return value === undefined ? "" : JSON.stringify(value);
}

function extractCommandOutput(value: string): string {
	const outputMarker = "\nOutput:\n";
	const markerIndex = value.indexOf(outputMarker);
	if (markerIndex < 0) {
		return value;
	}
	return value.slice(markerIndex + outputMarker.length);
}

function readRawGenericToolDetails(item: Record<string, unknown>): {
	details?: ToolCallDetail[];
} {
	const details: ToolCallDetail[] = [];
	for (const [label, value] of Object.entries(item)) {
		if (
			label === "type" ||
			label === "name" ||
			label === "call_id" ||
			label === "status"
		) {
			continue;
		}
		const rendered = renderToolDetailValue(value);
		if (rendered !== undefined) {
			details.push({ label, value: rendered });
		}
	}
	return details.length > 0 ? { details } : {};
}

/**
 * Item kinds that flow through `item/started` and `item/completed` but are
 * not tool invocations. We deliberately drop their lifecycle markers because
 * the substantive content arrives via dedicated streams (`item/agentMessage/
 * delta`, `item/reasoning/textDelta`) or is recorded by the runtime itself
 * (the user prompt).
 */
const NON_TOOL_ITEM_TYPES = new Set([
	"userMessage",
	"agentMessage",
	"reasoning",
]);

function readItemStarted(
	params: unknown,
	sessionId: string,
): FacadeEvent | undefined {
	const item = asRecord(asRecord(params)?.item);
	const itemType = typeof item?.type === "string" ? item.type : undefined;
	if (!item || !itemType || NON_TOOL_ITEM_TYPES.has(itemType)) {
		return undefined;
	}
	if (itemType === "commandExecution") {
		return readCommandExecutionStarted(params, sessionId);
	}
	if (itemType === "webSearch") {
		return readWebSearchStarted(params, sessionId);
	}
	if (itemType === "collabAgentToolCall") {
		return readSubagentToolStarted(params, sessionId);
	}
	if (itemType === "fileChange") {
		// fileChange has no useful content on `started`; the diff arrives on
		// `completed` and is normalized into a single `file_change_applied`.
		return undefined;
	}
	return readGenericToolStarted(params, sessionId);
}

function readItemCompleted(
	params: unknown,
	sessionId: string,
	commandOutputOverride?: string,
): FacadeEvent | undefined {
	const item = asRecord(asRecord(params)?.item);
	const itemType = typeof item?.type === "string" ? item.type : undefined;
	if (!item || !itemType || NON_TOOL_ITEM_TYPES.has(itemType)) {
		return undefined;
	}
	if (itemType === "commandExecution") {
		return readCommandExecutionCompleted(
			params,
			sessionId,
			commandOutputOverride,
		);
	}
	if (itemType === "fileChange") {
		return readFileChangeApplied(params, sessionId);
	}
	if (itemType === "webSearch") {
		return readWebSearchCompleted(params, sessionId);
	}
	if (itemType === "collabAgentToolCall") {
		return readSubagentToolCompleted(params, sessionId);
	}
	return readGenericToolCompleted(params, sessionId);
}

function readSubagentToolStarted(
	params: unknown,
	sessionId: string,
): FacadeEvent | undefined {
	const item = asRecord(asRecord(params)?.item);
	if (!item || item.type !== "collabAgentToolCall") {
		return undefined;
	}
	const callId = typeof item.id === "string" ? item.id : undefined;
	if (!callId) {
		return undefined;
	}
	return {
		type: "subagent_tool_started",
		callId,
		operation: readSubagentOperation(item),
		...readSubagentToolDetails(item),
		sessionId,
	};
}

function readSubagentToolCompleted(
	params: unknown,
	sessionId: string,
): FacadeEvent | undefined {
	const item = asRecord(asRecord(params)?.item);
	if (!item || item.type !== "collabAgentToolCall") {
		return undefined;
	}
	const callId = typeof item.id === "string" ? item.id : undefined;
	if (!callId) {
		return undefined;
	}
	const status = typeof item.status === "string" ? item.status : undefined;
	return {
		type: "subagent_tool_completed",
		callId,
		operation: readSubagentOperation(item),
		...(status ? { status } : {}),
		...readSubagentToolDetails(item),
		sessionId,
	};
}

function readSubagentToolDetails(item: Record<string, unknown>): {
	prompt?: string;
	model?: string;
	reasoningEffort?: string;
	targetIds: string[];
	agentStates: SubagentToolAgentState[];
} {
	const prompt =
		typeof item.prompt === "string" && item.prompt ? item.prompt : undefined;
	const model =
		typeof item.model === "string" && item.model ? item.model : undefined;
	const reasoningEffort =
		typeof item.reasoningEffort === "string" && item.reasoningEffort
			? item.reasoningEffort
			: undefined;
	const targetIds = Array.isArray(item.receiverThreadIds)
		? item.receiverThreadIds.filter(
				(value): value is string => typeof value === "string",
			)
		: [];
	return {
		...(prompt ? { prompt } : {}),
		...(model ? { model } : {}),
		...(reasoningEffort ? { reasoningEffort } : {}),
		targetIds,
		agentStates: readSubagentAgentStates(item.agentsStates),
	};
}

function readSubagentAgentStates(value: unknown): SubagentToolAgentState[] {
	const record = asRecord(value);
	if (!record) {
		return [];
	}
	const states: SubagentToolAgentState[] = [];
	for (const [agentId, rawState] of Object.entries(record)) {
		const stateRecord = asRecord(rawState);
		if (!stateRecord) {
			continue;
		}
		const status =
			typeof stateRecord.status === "string" ? stateRecord.status : undefined;
		const message =
			typeof stateRecord.message === "string" && stateRecord.message
				? stateRecord.message
				: undefined;
		states.push({
			agentId,
			...(status ? { status } : {}),
			...(message ? { message } : {}),
		});
	}
	return states;
}

function readSubagentOperation(item: Record<string, unknown>): string {
	const tool = typeof item.tool === "string" ? item.tool : undefined;
	switch (tool) {
		case "spawnAgent":
			return "spawn";
		case "sendInput":
			return "send";
		default:
			return tool ?? "subagent";
	}
}

function readWebSearchStarted(
	params: unknown,
	sessionId: string,
): FacadeEvent | undefined {
	const item = asRecord(asRecord(params)?.item);
	if (!item || item.type !== "webSearch") {
		return undefined;
	}
	const callId = typeof item.id === "string" ? item.id : undefined;
	if (!callId) {
		return undefined;
	}
	const query =
		typeof item.query === "string" && item.query ? item.query : undefined;
	return {
		type: "web_search_started",
		callId,
		...(query ? { query } : {}),
		sessionId,
	};
}

function readWebSearchCompleted(
	params: unknown,
	sessionId: string,
): FacadeEvent | undefined {
	const item = asRecord(asRecord(params)?.item);
	if (!item || item.type !== "webSearch") {
		return undefined;
	}
	const callId = typeof item.id === "string" ? item.id : undefined;
	if (!callId) {
		return undefined;
	}
	const action = asRecord(item.action);
	const query =
		(typeof item.query === "string" && item.query ? item.query : undefined) ??
		(typeof action?.query === "string" && action.query
			? (action.query as string)
			: undefined);
	const queries = Array.isArray(action?.queries)
		? (action?.queries as unknown[]).filter(
				(q): q is string => typeof q === "string",
			)
		: undefined;
	return {
		type: "web_search_completed",
		callId,
		...(query ? { query } : {}),
		...(queries && queries.length > 0 ? { queries } : {}),
		sessionId,
	};
}

function readGenericToolStarted(
	params: unknown,
	sessionId: string,
): FacadeEvent | undefined {
	const item = asRecord(asRecord(params)?.item);
	const callId = typeof item?.id === "string" ? item.id : undefined;
	const toolKind = typeof item?.type === "string" ? item.type : undefined;
	if (!item || !callId || !toolKind) {
		return undefined;
	}
	return {
		type: "tool_call_started",
		callId,
		toolKind,
		...readGenericToolDetails(item),
		sessionId,
	};
}

function readGenericToolCompleted(
	params: unknown,
	sessionId: string,
): FacadeEvent | undefined {
	const item = asRecord(asRecord(params)?.item);
	const callId = typeof item?.id === "string" ? item.id : undefined;
	const toolKind = typeof item?.type === "string" ? item.type : undefined;
	if (!item || !callId || !toolKind) {
		return undefined;
	}
	const status = typeof item.status === "string" ? item.status : undefined;
	return {
		type: "tool_call_completed",
		callId,
		toolKind,
		...(status ? { status } : {}),
		...readGenericToolDetails(item),
		sessionId,
	};
}

/**
 * Project unknown provider tool bodies into a small display field list. This
 * preserves useful monitor context without making raw provider payloads a
 * durable runtime/frontend contract.
 */
function readGenericToolDetails(item: Record<string, unknown>): {
	details?: ToolCallDetail[];
} {
	const details: ToolCallDetail[] = [];
	for (const [label, value] of Object.entries(item)) {
		if (label === "type" || label === "id" || label === "status") {
			continue;
		}
		const rendered = renderToolDetailValue(value);
		if (rendered !== undefined) {
			details.push({ label, value: rendered });
		}
	}
	return details.length > 0 ? { details } : {};
}

function renderToolDetailValue(value: unknown): string | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value === "string") {
		return value;
	}
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "bigint"
	) {
		return String(value);
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
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
	outputOverride?: string,
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
		outputOverride ??
		(typeof item.aggregatedOutput === "string"
			? item.aggregatedOutput
			: undefined);
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
