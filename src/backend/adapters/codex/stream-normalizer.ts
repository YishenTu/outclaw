import type {
	CodingSessionEvent,
	DisplayImage,
	FacadeEvent,
	FileChange,
	FileChangeKind,
	ImageMediaType,
	SubagentToolAgentState,
	ToolCallDetail,
	UsageInfo,
} from "../../../common/protocol.ts";
import {
	normalizeCodexJsonlUserPromptText,
	stripOaiMemoryCitationBlocks,
} from "./transcript-cleanup.ts";
import type {
	CodexServerNotification,
	CodexThreadTokenUsage,
	CodexTurn,
	CodexTurnError,
} from "./types.ts";

interface NormalizeCodexTurnOptions {
	acceptAnyTurnId?: boolean;
	notifications: AsyncIterable<CodexServerNotification>;
	threadId: string;
	turnIds: ReadonlySet<string>;
	isCurrentTurnId?: (turnId: string) => boolean;
	sessionId: string;
	startedAtMs: number;
}

class CodexToolCallProjectionState {
	private readonly commandCallIds = new Set<string>();
	private readonly commandOutputsByCallId = new Map<string, string>();
	private readonly genericToolKindsByCallId = new Map<string, string>();
	private readonly suppressedCallIds = new Set<string>();

	markCommandStarted(callId: string): void {
		this.commandCallIds.add(callId);
	}

	hasCommandStarted(callId: string): boolean {
		return this.commandCallIds.has(callId);
	}

	rememberCommandOutput(callId: string, output: string): void {
		this.commandOutputsByCallId.set(callId, output);
	}

	readCommandOutput(callId: string): string | undefined {
		return this.commandOutputsByCallId.get(callId);
	}

	forgetCommandOutput(callId: string): void {
		this.commandOutputsByCallId.delete(callId);
	}

	commandOutputs(): Iterable<[string, string]> {
		return this.commandOutputsByCallId;
	}

	markGenericToolStarted(callId: string, toolKind: string): void {
		this.genericToolKindsByCallId.set(callId, toolKind);
	}

	consumeGenericToolKind(callId: string): string | undefined {
		const toolKind = this.genericToolKindsByCallId.get(callId);
		if (toolKind) {
			this.genericToolKindsByCallId.delete(callId);
		}
		return toolKind;
	}

	suppress(callId: string): void {
		this.suppressedCallIds.add(callId);
	}

	isSuppressed(callId: string): boolean {
		return this.suppressedCallIds.has(callId);
	}

	consumeSuppressed(callId: string): boolean {
		if (!this.suppressedCallIds.has(callId)) {
			return false;
		}
		this.suppressedCallIds.delete(callId);
		return true;
	}

	clearCommandOutputs(): void {
		this.commandOutputsByCallId.clear();
	}
}

export async function* normalizeCodexTurnNotifications(
	options: NormalizeCodexTurnOptions,
): AsyncIterable<FacadeEvent> {
	let pendingUsage: UsageInfo | undefined;
	let terminalError = false;
	let streamedAssistantText = "";
	const finalAssistantMessageIds = new Set<string>();
	const projection = new CodexToolCallProjectionState();
	const completedCommands = new Set<string>();

	for await (const notification of options.notifications) {
		if (
			!isNotificationForTurn(
				notification,
				options.threadId,
				options.turnIds,
				options.acceptAnyTurnId,
			)
		) {
			continue;
		}

		switch (notification.method) {
			case "item/agentMessage/delta": {
				const delta = readString(notification.params, "delta");
				if (delta) {
					streamedAssistantText += delta;
					yield {
						type: "text",
						text: delta,
						sessionId: options.sessionId,
					};
				}
				break;
			}
			case "event_msg": {
				const payload = asRecord(notification.params);
				if (!payload) {
					break;
				}
				const payloadType =
					typeof payload.type === "string" ? payload.type : undefined;
				switch (payloadType) {
					case "user_message": {
						const text =
							typeof payload.message === "string" ? payload.message : "";
						if (isCodexTurnAbortedMessage(text)) {
							yield {
								type: "turn_aborted",
								sessionId: options.sessionId,
							};
							return;
						}
						break;
					}
					case "agent_message": {
						const text =
							typeof payload.message === "string" ? payload.message : "";
						const missingText = normalizeAgentMessageCompletionText(
							text,
							streamedAssistantText,
						);
						if (missingText) {
							yield {
								type: "text",
								text: missingText,
								sessionId: options.sessionId,
							};
						}
						break;
					}
					case "task_complete": {
						const completedTurnId = readEventPayloadTurnId(payload);
						if (
							completedTurnId &&
							options.isCurrentTurnId &&
							!options.isCurrentTurnId(completedTurnId)
						) {
							break;
						}
						yield {
							type: "done",
							sessionId: options.sessionId,
							durationMs: readJsonlDurationMs(payload),
							...(pendingUsage ? { usage: pendingUsage } : {}),
						};
						return;
					}
					default:
						break;
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
					streamedAssistantText,
					projection,
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
				const callId = readItemCallId(notification.params);
				if (callId && projection.isSuppressed(callId)) {
					break;
				}
				const event = readItemStarted(notification.params, options.sessionId);
				if (event) {
					if (
						event.type === "command_execution_started" &&
						projection.hasCommandStarted(event.callId)
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
					) &&
					isCurrentNotificationTurn(
						notification.params,
						options.isCurrentTurnId,
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
				if (callId && projection.consumeSuppressed(callId)) {
					break;
				}
				const rawOutput = callId
					? projection.readCommandOutput(callId)
					: undefined;
				const event = readItemCompleted(
					notification.params,
					options.sessionId,
					rawOutput,
				);
				if (event) {
					if (event.type === "command_execution_completed") {
						completedCommands.add(event.callId);
						projection.forgetCommandOutput(event.callId);
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
				if (
					turn?.id &&
					options.isCurrentTurnId &&
					!options.isCurrentTurnId(turn.id)
				) {
					break;
				}
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
				for (const [callId, output] of projection.commandOutputs()) {
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
				projection.clearCommandOutputs();
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
): CodingSessionEvent[] {
	const events: CodingSessionEvent[] = [];
	const projection = new CodexToolCallProjectionState();
	const terminalCommandCallIds = new Map<string, string>();
	const writeStdinParentCallIds = new Map<string, string>();
	const runningCommandCallIds = new Set<string>();

	for (const parsedLine of parseCodexJsonlRows(content)) {
		const row = asRecord(parsedLine);
		const payload = asRecord(row?.payload);
		if (!row || !payload) {
			continue;
		}
		const timestamp = readJsonlRowTimestamp(row);
		const rowType = typeof row.type === "string" ? row.type : undefined;
		const payloadType =
			typeof payload.type === "string" ? payload.type : undefined;

		if (rowType === "response_item") {
			switch (payloadType) {
				case "message": {
					const text = stripOaiMemoryCitationBlocks(
						readContentText(payload.content),
					);
					if (payload.role === "user" && isCodexTurnAbortedMessage(text)) {
						events.push({
							type: "turn_aborted",
							sessionId: options.sessionId,
						});
						break;
					}
					const userPromptText =
						payload.role === "user"
							? normalizeCodexJsonlUserPromptText(text)
							: "";
					const userImages =
						payload.role === "user" ? readContentImages(payload.content) : [];
					if (
						payload.role === "user" &&
						(userPromptText || userImages.length > 0)
					) {
						events.push({
							type: "user_prompt",
							text: userPromptText,
							...(userImages.length > 0 ? { images: userImages } : {}),
							sessionId: options.sessionId,
							...(timestamp !== undefined ? { timestamp } : {}),
						});
					} else if (payload.role === "assistant") {
						if (text) {
							events.push({
								type: "text",
								text,
								sessionId: options.sessionId,
								...(timestamp !== undefined ? { timestamp } : {}),
							});
						}
						if (payload.phase === "final_answer") {
							recordJsonlDone(events, options.sessionId, 0, timestamp);
						}
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
							...(timestamp !== undefined ? { timestamp } : {}),
						});
					}
					break;
				}
				case "contextCompaction":
				case "context_compaction": {
					events.push({
						type: "compacting_finished",
						sessionId: options.sessionId,
					});
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
							projection.markCommandStarted(event.callId);
							events.push(event);
						}
						break;
					}
					if (name === "write_stdin") {
						const callId =
							typeof payload.call_id === "string" ? payload.call_id : undefined;
						const args = parseJsonObject(payload.arguments);
						const terminalSessionId = readTerminalSessionIdArgument(args);
						if (callId && terminalSessionId) {
							const parentCallId =
								terminalCommandCallIds.get(terminalSessionId);
							if (parentCallId) {
								writeStdinParentCallIds.set(callId, parentCallId);
							}
						}
						break;
					}
					for (const event of readRawGenericToolStarted(
						payload,
						options.sessionId,
					)) {
						if (event.type === "tool_call_started") {
							projection.markGenericToolStarted(event.callId, event.toolKind);
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
					if (projection.hasCommandStarted(callId)) {
						const commandResult = readCommandToolResult(payload.output);
						if (commandResult.status === "running") {
							runningCommandCallIds.add(callId);
							if (commandResult.terminalSessionId) {
								terminalCommandCallIds.set(
									commandResult.terminalSessionId,
									callId,
								);
							}
							if (commandResult.output) {
								events.push({
									type: "command_execution_output",
									callId,
									output: commandResult.output,
									sessionId: options.sessionId,
								});
							}
							break;
						}
						runningCommandCallIds.delete(callId);
						events.push({
							type: "command_execution_completed",
							callId,
							...(commandResult.exitCode !== undefined
								? { exitCode: commandResult.exitCode }
								: {}),
							...(commandResult.output !== undefined
								? { output: commandResult.output }
								: {}),
							sessionId: options.sessionId,
						});
						break;
					}
					const writeStdinParentCallId = writeStdinParentCallIds.get(callId);
					if (writeStdinParentCallId) {
						const commandResult = readCommandToolResult(payload.output);
						if (commandResult.output) {
							events.push({
								type: "command_execution_output",
								callId: writeStdinParentCallId,
								output: commandResult.output,
								sessionId: options.sessionId,
							});
						}
						if (commandResult.status === "completed") {
							runningCommandCallIds.delete(writeStdinParentCallId);
							events.push({
								type: "command_execution_completed",
								callId: writeStdinParentCallId,
								...(commandResult.exitCode !== undefined
									? { exitCode: commandResult.exitCode }
									: {}),
								sessionId: options.sessionId,
							});
							writeStdinParentCallIds.delete(callId);
						}
						break;
					}
					const toolKind = projection.consumeGenericToolKind(callId);
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
							projection.markGenericToolStarted(event.callId, event.toolKind);
						}
						events.push(event);
					}
					break;
				}
				case "custom_tool_call_output": {
					// The codex responses API does not echo `name` on the output
					// side — match by call_id instead. If the matching started
					// event was suppressed (e.g. apply_patch), the output is an
					// orphan and would render as a bare "Success. Updated …"
					// card with no header context; drop it.
					const callId =
						typeof payload.call_id === "string" ? payload.call_id : undefined;
					if (!callId || !projection.consumeGenericToolKind(callId)) {
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
				case "task_complete": {
					recordJsonlDone(
						events,
						options.sessionId,
						readJsonlDurationMs(payload),
						timestamp,
					);
					break;
				}
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

	for (const callId of runningCommandCallIds) {
		events.push({
			type: "command_execution_completed",
			callId,
			sessionId: options.sessionId,
		});
	}

	return events;
}

function* parseCodexJsonlRows(content: string): Iterable<unknown> {
	const lines = content.split("\n");
	const lastNonEmptyLineIndex = findLastNonEmptyLineIndex(lines);
	const mayHaveTrailingPartialRow = !content.endsWith("\n");

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (!line.trim()) {
			continue;
		}
		try {
			yield JSON.parse(line);
		} catch (error) {
			if (mayHaveTrailingPartialRow && index === lastNonEmptyLineIndex) {
				return;
			}
			throw error;
		}
	}
}

function findLastNonEmptyLineIndex(lines: string[]): number {
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if (lines[index]?.trim()) {
			return index;
		}
	}
	return -1;
}

function readJsonlDurationMs(payload: Record<string, unknown>): number {
	const durationMs = payload.duration_ms;
	return typeof durationMs === "number" && durationMs >= 0 ? durationMs : 0;
}

function readJsonlRowTimestamp(
	row: Record<string, unknown>,
): number | undefined {
	return readTimestampMs(row.timestamp ?? row.createdAt ?? row.created_at);
}

function readTimestampMs(value: unknown): number | undefined {
	if (typeof value === "string") {
		const parsedDate = Date.parse(value);
		if (Number.isFinite(parsedDate)) {
			return parsedDate;
		}
		const parsedNumber = Number(value);
		return Number.isFinite(parsedNumber)
			? normalizeUnixTimestampMs(parsedNumber)
			: undefined;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return normalizeUnixTimestampMs(value);
	}
	return undefined;
}

function normalizeUnixTimestampMs(value: number): number | undefined {
	if (value < 0) {
		return undefined;
	}
	return value < 10_000_000_000 ? Math.round(value * 1000) : Math.round(value);
}

function recordJsonlDone(
	events: CodingSessionEvent[],
	sessionId: string,
	durationMs: number,
	timestamp?: number,
): void {
	const currentTurnDone = findCurrentTurnDone(events, sessionId);
	if (currentTurnDone) {
		currentTurnDone.durationMs = Math.max(
			currentTurnDone.durationMs,
			durationMs,
		);
		if (timestamp !== undefined) {
			currentTurnDone.timestamp = Math.max(
				currentTurnDone.timestamp ?? timestamp,
				timestamp,
			);
		}
		return;
	}
	events.push({
		type: "done",
		sessionId,
		durationMs,
		...(timestamp !== undefined ? { timestamp } : {}),
	});
}

function findCurrentTurnDone(
	events: CodingSessionEvent[],
	sessionId: string,
): Extract<CodingSessionEvent, { type: "done" }> | undefined {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (!event) {
			continue;
		}
		if (event.type === "done") {
			if (event.sessionId === sessionId) {
				return event;
			}
			continue;
		}
		if (event.type === "user_prompt") {
			if (event.sessionId === undefined || event.sessionId === sessionId) {
				return undefined;
			}
			continue;
		}
		if (event.type === "error") {
			if (event.sessionId === undefined || event.sessionId === sessionId) {
				return undefined;
			}
		}
	}
	return undefined;
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
	turnIds: ReadonlySet<string>,
	acceptAnyTurnId = false,
): boolean {
	const params = asRecord(notification.params);
	if (!params || params.threadId !== threadId) {
		return false;
	}
	if (acceptAnyTurnId) {
		return true;
	}

	if (notification.method === "turn/completed") {
		const completedTurnId = readTurn(params)?.id;
		return completedTurnId !== undefined && turnIds.has(completedTurnId);
	}

	const notificationTurnId =
		typeof params.turnId === "string" ? params.turnId : undefined;
	return notificationTurnId !== undefined && turnIds.has(notificationTurnId);
}

function isCurrentNotificationTurn(
	params: unknown,
	isCurrentTurnId: ((turnId: string) => boolean) | undefined,
): boolean {
	if (!isCurrentTurnId) {
		return true;
	}
	const turnId = readNotificationTurnId(params);
	return !turnId || isCurrentTurnId(turnId);
}

function readNotificationTurnId(params: unknown): string | undefined {
	const record = asRecord(params);
	return typeof record?.turnId === "string" ? record.turnId : undefined;
}

function readEventPayloadTurnId(
	payload: Record<string, unknown>,
): string | undefined {
	const turnId = payload.turn_id ?? payload.turnId;
	return typeof turnId === "string" ? turnId : undefined;
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
	streamedAssistantText: string,
	projection: CodexToolCallProjectionState,
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
			projection.markCommandStarted(event.callId);
			return [event];
		}
		if (name === "write_stdin") {
			const callId =
				typeof item.call_id === "string" ? item.call_id : undefined;
			if (callId) {
				projection.suppress(callId);
			}
			return [];
		}
		const events = readRawGenericToolStarted(item, sessionId);
		for (const event of events) {
			if (event.type === "tool_call_started") {
				projection.markGenericToolStarted(event.callId, event.toolKind);
			}
		}
		return events;
	}

	if (itemType === "function_call_output") {
		const callId = typeof item.call_id === "string" ? item.call_id : undefined;
		if (!callId) {
			return [];
		}
		if (projection.consumeSuppressed(callId)) {
			return [];
		}
		const output = normalizeFunctionOutput(item.output);
		if (projection.hasCommandStarted(callId)) {
			projection.rememberCommandOutput(callId, output);
			return [];
		}
		const toolKind = projection.consumeGenericToolKind(callId);
		if (!toolKind) {
			return [];
		}
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
			const callId =
				typeof item.call_id === "string" ? item.call_id : undefined;
			if (callId) {
				projection.suppress(callId);
			}
			return [];
		}
		const events = readRawGenericToolStarted(item, sessionId);
		for (const event of events) {
			if (event.type === "tool_call_started") {
				projection.markGenericToolStarted(event.callId, event.toolKind);
			}
		}
		return events;
	}

	if (itemType === "custom_tool_call_output") {
		// The codex responses API does not echo `name` on the output side —
		// match by call_id instead. If the matching started event was
		// suppressed (e.g. apply_patch), the output is an orphan and would
		// render as a bare "Success. Updated …" card with no header context;
		// drop it.
		const callId = typeof item.call_id === "string" ? item.call_id : undefined;
		if (callId && projection.consumeSuppressed(callId)) {
			return [];
		}
		if (!callId || !projection.consumeGenericToolKind(callId)) {
			return [];
		}
		return readRawGenericToolCompleted(item, sessionId);
	}

	if (itemType === "agentMessage") {
		const text = readContentText(item.content);
		const missingText = normalizeAgentMessageCompletionText(
			text,
			streamedAssistantText,
		);
		if (!missingText) {
			return [];
		}
		return [
			{
				type: "text",
				text: missingText,
				sessionId,
			},
		];
	}

	return [];
}

function normalizeAgentMessageCompletionText(
	text: string,
	streamedAssistantText: string,
): string {
	if (!text) {
		return "";
	}
	if (!streamedAssistantText) {
		return text;
	}
	if (text.startsWith(streamedAssistantText)) {
		return text.slice(streamedAssistantText.length);
	}
	return text;
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
	return typeof item?.id === "string"
		? item.id
		: typeof item?.call_id === "string"
			? item.call_id
			: undefined;
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

function readContentImages(value: unknown): DisplayImage[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const images: DisplayImage[] = [];
	for (const entry of value) {
		const record = asRecord(entry);
		if (!record) {
			continue;
		}
		const path =
			typeof record.path === "string"
				? record.path
				: typeof record.localPath === "string"
					? record.localPath
					: undefined;
		if (!path || !isLocalImageContent(record)) {
			continue;
		}
		images.push({
			kind: "managed",
			path,
			mediaType:
				readImageMediaType(record.mediaType ?? record.media_type) ??
				inferImageMediaTypeFromPath(path) ??
				"image/png",
		});
	}
	return images;
}

function isLocalImageContent(record: Record<string, unknown>): boolean {
	return (
		record.type === "localImage" ||
		record.type === "local_image" ||
		record.type === "input_image" ||
		record.type === "image"
	);
}

function readImageMediaType(value: unknown): ImageMediaType | undefined {
	if (
		value === "image/jpeg" ||
		value === "image/png" ||
		value === "image/gif" ||
		value === "image/webp"
	) {
		return value;
	}
	return undefined;
}

function inferImageMediaTypeFromPath(path: string): ImageMediaType | undefined {
	const lowerPath = path.toLowerCase();
	if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) {
		return "image/jpeg";
	}
	if (lowerPath.endsWith(".png")) {
		return "image/png";
	}
	if (lowerPath.endsWith(".gif")) {
		return "image/gif";
	}
	if (lowerPath.endsWith(".webp")) {
		return "image/webp";
	}
	return undefined;
}

function isCodexTurnAbortedMessage(text: string): boolean {
	const trimmed = text.trim();
	return (
		trimmed.startsWith("<turn_aborted>") && trimmed.endsWith("</turn_aborted>")
	);
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

function readCommandToolResult(value: unknown): {
	output: string;
	status: "completed" | "running";
	exitCode?: number;
	terminalSessionId?: string;
} {
	const output = normalizeFunctionOutput(value);
	if (typeof value !== "string") {
		return { output, status: "completed" };
	}
	const exitMatch = value.match(/\nProcess exited with code (-?\d+)\n/);
	const runningMatch = value.match(
		/\nProcess running with session ID ([^\n]+)\n/,
	);
	return {
		output,
		status: exitMatch ? "completed" : runningMatch ? "running" : "completed",
		...(exitMatch
			? { exitCode: Number.parseInt(exitMatch[1] as string, 10) }
			: {}),
		...(runningMatch
			? { terminalSessionId: (runningMatch[1] as string).trim() }
			: {}),
	};
}

function readTerminalSessionIdArgument(
	args: Record<string, unknown> | undefined,
): string | undefined {
	if (!args) {
		return undefined;
	}
	const value = args.session_id ?? args.sessionId;
	if (typeof value === "string" && value) {
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	return undefined;
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
	if (itemType === "contextCompaction") {
		return { type: "compacting_started", sessionId };
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
	if (itemType === "contextCompaction") {
		return { type: "compacting_finished", sessionId };
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
