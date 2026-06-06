import type {
	NativeToolResult,
	OutclawCodingData,
	OutclawCodingParams,
	OutclawCronData,
	OutclawCronParams,
	OutclawMemoryNoteData,
	OutclawMemoryNoteParams,
	OutclawNativeToolContext,
	OutclawNativeToolHost,
	OutclawPeerMessageData,
	OutclawPeerMessageParams,
	OutclawRecallData,
	OutclawRecallParams,
	OutclawSchemaData,
	OutclawSchemaParams,
} from "../../common/native-tools.ts";
import type { TranscriptTurn } from "../../common/protocol.ts";
import {
	formatProviderSessionRef,
	type ProviderSessionRef,
} from "../../common/provider-session-ref.ts";
import { appendDailyMemoryNote } from "../memory/daily-memory-note.ts";
import {
	loadMemorySchemaStatuses,
	selectMemorySchemaStatuses,
} from "../memory/schema-status.ts";
import { createOutclawNativeToolHost } from "./host.ts";

const CODING_STATUS_POLL_MS = 10;
const DEFAULT_CODING_STATUS_TIMEOUT_SECONDS = 30;

export interface NativeToolAgentInfo {
	readonly agentId: string;
	readonly name: string;
	readonly homeDir: string;
	readonly memoryRoot: string;
}

export interface NativeToolSessionSummary {
	readonly agentId: string;
	readonly providerId: string;
	readonly sdkSessionId: string;
	readonly title: string;
	readonly tag: "chat" | "cron";
	readonly model?: string;
	readonly lastActive: number;
	readonly matches?: readonly {
		readonly role: "user" | "assistant";
		readonly content: string;
		readonly timestamp: number;
	}[];
}

export interface NativeToolSessionListResult {
	readonly sessions: readonly NativeToolSessionSummary[];
	readonly nextCursor?: string;
}

export type NativeToolSessionReaderResult =
	| readonly NativeToolSessionSummary[]
	| NativeToolSessionListResult
	| NativeToolResult<NativeToolSessionListResult>;

export interface NativeToolSessionReader {
	getSession?(params: {
		agentId: string;
		providerId: string;
		sdkSessionId: string;
		tag: "chat" | "cron";
	}): NativeToolSessionSummary | undefined;
	listSessions(params: {
		agentId?: string;
		cursor?: string;
		limit?: number;
		query?: string;
		tag: "chat" | "cron";
	}): NativeToolSessionReaderResult;
}

export interface NativeToolPeerMessenger {
	send(params: {
		fromAgentId: string;
		fromAgentName: string;
		targetAgentId: string;
		targetAgentName: string;
		message: string;
	}): boolean;
	ask(params: {
		fromAgentId: string;
		fromAgentName: string;
		targetAgentId: string;
		targetAgentName: string;
		message: string;
		timeoutSeconds?: number;
	}): Promise<string>;
}

export interface NativeToolCronFailure {
	readonly jobName: string;
	readonly sessionRef?: string;
	readonly startedAt: number;
	readonly error: string;
}

export interface NativeToolCronRunResult {
	readonly accepted: boolean;
	readonly sessionRef?: string;
	readonly message?: string;
}

export interface NativeToolCronRunner {
	listFailedRuns(params: {
		agentId?: string;
		jobName?: string;
		limit?: number;
		namesOnly?: boolean;
		sinceEpochMs?: number;
	}): readonly NativeToolCronFailure[];
	runJob?(params: {
		agentId: string;
		jobName: string;
	}): NativeToolCronRunResult | Promise<NativeToolCronRunResult>;
}

export interface NativeToolCodingSession {
	readonly providerId: string;
	readonly sdkSessionId: string;
	readonly runStatus: "idle" | "running" | "failed" | "cancelled";
	readonly title?: string;
	readonly cwd?: string;
	readonly repositoryId?: string;
	readonly linkedChatSessionId?: string;
	readonly lastActive?: number;
	readonly failureMessage?: string;
}

export interface NativeToolCodingRepository {
	readonly id: string;
	readonly rootCwd: string;
	readonly displayName: string;
	readonly source: string;
	readonly status: string;
	readonly lastActive: number;
}

export interface NativeToolCodingListResult {
	readonly repositories: readonly NativeToolCodingRepository[];
	readonly sessions: readonly (NativeToolCodingSession & {
		readonly cwd: string;
		readonly lastActive: number;
	})[];
}

export interface NativeToolCodingStartResult {
	readonly providerId: string;
	readonly sdkSessionId: string;
	readonly status: Extract<
		OutclawCodingData,
		{ mode: "start" | "resume" }
	>["status"];
	readonly turnId?: string;
}

export interface NativeToolLinkedChatSession {
	readonly agentId: string;
	readonly providerId: string;
	readonly sdkSessionId: string;
}

export interface NativeToolCodingReader {
	list?(params: {
		repository?: string;
		includeArchived?: boolean;
		limit?: number;
	}): NativeToolCodingListResult | Promise<NativeToolCodingListResult>;
	resolveSession(params: {
		providerId: string;
		sdkSessionId: string;
	}): NativeToolCodingSession | undefined;
	readEvents(params: {
		providerId: string;
		sdkSessionId: string;
	}): Promise<readonly Record<string, unknown>[]>;
	start?(params: {
		target: string;
		prompt: string;
		cwd?: string;
		linkedChatSession?: NativeToolLinkedChatSession;
	}): Promise<NativeToolCodingStartResult>;
	resume?(params: {
		providerId: string;
		sdkSessionId: string;
		prompt: string;
	}): Promise<NativeToolCodingStartResult>;
	cancel?(params: {
		providerId: string;
		sdkSessionId: string;
	}): boolean | Promise<boolean>;
}

export interface RuntimeNativeToolHostOptions {
	readonly agents: readonly NativeToolAgentInfo[];
	readonly coding?: NativeToolCodingReader;
	readonly context: OutclawNativeToolContext;
	readonly cron?: NativeToolCronRunner;
	readonly currentAgentId: string;
	readonly now?: () => Date;
	readonly peers?: NativeToolPeerMessenger;
	readonly readTranscript?: (params: {
		agentId: string;
		providerId: string;
		sdkSessionId: string;
	}) => Promise<readonly TranscriptTurn[] | undefined>;
	readonly sessions?: NativeToolSessionReader;
}

export function createRuntimeNativeToolHost(
	options: RuntimeNativeToolHostOptions,
): OutclawNativeToolHost {
	return createOutclawNativeToolHost({
		context: options.context,
		handlers: {
			peerMessage: async (params) => peerMessage(options, params),
			memoryNote: async (params) => memoryNote(options, params),
			recall: async (params) => {
				if (params.mode === "sessions") {
					return recallSessions(options, params);
				}
				return await recallTranscript(options, params);
			},
			schema: async (params) => schema(options, params),
			cron: async (params) => cron(options, params),
			coding: async (params) => coding(options, params),
		},
	});
}

async function peerMessage(
	options: RuntimeNativeToolHostOptions,
	params: OutclawPeerMessageParams,
): Promise<NativeToolResult<OutclawPeerMessageData>> {
	if (params.mode === "list") {
		return {
			ok: true,
			data: {
				mode: "list",
				agents: options.agents.map((agent) => ({
					agentId: agent.agentId,
					name: agent.name,
					current: agent.agentId === options.currentAgentId,
				})),
			},
		};
	}
	if (!options.peers) {
		return {
			ok: false,
			error: {
				code: "context_disabled",
				message: "Peer messaging is not configured",
			},
		};
	}
	const fromAgent = resolveAgent(options, undefined);
	if (!fromAgent) {
		return {
			ok: false,
			error: {
				code: "context_disabled",
				message: "Current agent is not available",
			},
		};
	}
	const targetAgent = resolveAgent(options, params.targetAgent);
	if (!targetAgent) {
		return {
			ok: false,
			error: {
				code: "not_found",
				message: `Agent not found: ${params.targetAgent}`,
			},
		};
	}
	if (targetAgent.agentId === fromAgent.agentId) {
		return {
			ok: false,
			error: {
				code: "validation_error",
				message: "Peer messaging requires a different target agent",
			},
		};
	}

	try {
		if (params.mode === "send") {
			const accepted = options.peers.send({
				fromAgentId: fromAgent.agentId,
				fromAgentName: fromAgent.name,
				targetAgentId: targetAgent.agentId,
				targetAgentName: targetAgent.name,
				message: params.message,
			});
			return {
				ok: true,
				data: {
					mode: "send",
					targetAgent: params.targetAgent,
					accepted,
					...(options.context.providerSessionRef === undefined
						? {}
						: { sessionRef: options.context.providerSessionRef }),
				},
			};
		}

		const responseText = await askWithOptionalTimeout(
			options.peers.ask({
				fromAgentId: fromAgent.agentId,
				fromAgentName: fromAgent.name,
				targetAgentId: targetAgent.agentId,
				targetAgentName: targetAgent.name,
				message: params.message,
				...(params.timeoutSeconds === undefined
					? {}
					: { timeoutSeconds: params.timeoutSeconds }),
			}),
			params.timeoutSeconds,
		);
		return {
			ok: true,
			data: {
				mode: "ask",
				targetAgent: params.targetAgent,
				accepted: true,
				responseText,
				...(options.context.providerSessionRef === undefined
					? {}
					: { sessionRef: options.context.providerSessionRef }),
			},
		};
	} catch (error) {
		if (error instanceof NativeToolTimeoutError) {
			return {
				ok: false,
				error: {
					code: "timeout",
					message: `Peer ask timed out after ${params.timeoutSeconds} seconds`,
					retryable: true,
				},
			};
		}
		return {
			ok: false,
			error: {
				code: "provider_failure",
				message: error instanceof Error ? error.message : String(error),
				retryable: true,
			},
		};
	}
}

function recallSessions(
	options: RuntimeNativeToolHostOptions,
	params: Extract<OutclawRecallParams, { mode: "sessions" }>,
): NativeToolResult<OutclawRecallData> {
	if (!options.sessions) {
		return {
			ok: false,
			error: {
				code: "context_disabled",
				message: "Session recall is not configured",
			},
		};
	}

	const targetAgent = params.allAgents
		? undefined
		: resolveAgent(options, params.agent);
	if (!params.allAgents && !targetAgent) {
		return {
			ok: false,
			error: {
				code: "not_found",
				message: `Agent not found: ${params.agent ?? options.currentAgentId}`,
			},
		};
	}
	const tag = params.tag ?? "chat";
	const rows = options.sessions.listSessions({
		...(targetAgent === undefined ? {} : { agentId: targetAgent.agentId }),
		...(params.cursor === undefined ? {} : { cursor: params.cursor }),
		...(params.limit === undefined ? {} : { limit: params.limit }),
		...(params.query === undefined ? {} : { query: params.query }),
		tag,
	});
	const result = normalizeSessionListResult(rows);
	if (!result.ok) {
		return {
			ok: false,
			error: result.error,
		};
	}

	return {
		ok: true,
		data: {
			mode: "sessions",
			sessions: result.data.sessions.map((row) => ({
				sessionRef: formatNativeSessionRef(row),
				providerId: row.providerId,
				agentId: row.agentId,
				title: row.title,
				...(row.model === undefined ? {} : { model: row.model }),
				tag: row.tag,
				lastActiveAt: row.lastActive,
				...(row.matches === undefined || row.matches.length === 0
					? {}
					: { matches: row.matches }),
			})),
			...(result.data.nextCursor === undefined
				? {}
				: { nextCursor: result.data.nextCursor }),
		},
	};
}

function normalizeSessionListResult(
	result: NativeToolSessionReaderResult,
): NativeToolResult<NativeToolSessionListResult> {
	if (isNativeToolResult(result)) {
		return result;
	}
	return {
		ok: true,
		data: "sessions" in result ? result : { sessions: result },
	};
}

function isNativeToolResult<T>(value: unknown): value is NativeToolResult<T> {
	return typeof value === "object" && value !== null && "ok" in value;
}

function memoryNote(
	options: RuntimeNativeToolHostOptions,
	params: OutclawMemoryNoteParams,
): NativeToolResult<OutclawMemoryNoteData> {
	const targetAgent = resolveAgent(options, undefined);
	if (!targetAgent) {
		return {
			ok: false,
			error: {
				code: "context_disabled",
				message: "Current agent memory root is not available",
			},
		};
	}
	const sessionRef =
		options.context.providerSessionRef ??
		`${options.context.agentId}/unknown-session`;
	try {
		const result = appendDailyMemoryNote({
			content: params.text,
			hint: params.title,
			memoryRoot: targetAgent.memoryRoot,
			salience: params.salience,
			sessionId: sessionRef,
			...(params.tags === undefined ? {} : { tags: params.tags }),
			now: options.now?.(),
		});
		return {
			ok: true,
			data: {
				path: result.path,
				...(params.title === undefined ? {} : { title: params.title }),
				timestamp: result.timestamp,
				...(options.context.providerSessionRef === undefined
					? {}
					: { sessionRef: options.context.providerSessionRef }),
			},
		};
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "provider_failure",
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

async function coding(
	options: RuntimeNativeToolHostOptions,
	params: OutclawCodingParams,
): Promise<NativeToolResult<OutclawCodingData>> {
	if (params.mode === "start") {
		return await startCoding(options, params);
	}
	if (params.mode === "resume") {
		return await resumeCoding(options, params);
	}
	if (params.mode === "cancel") {
		return await cancelCoding(options, params);
	}
	if (params.mode === "list") {
		return await listCoding(options, params);
	}
	if (!options.coding) {
		return {
			ok: false,
			error: {
				code: "context_disabled",
				message: "Coding inspection is not configured",
			},
		};
	}
	const ref = parseNativeSessionRef(params.sessionRef);
	if (!ref) {
		return {
			ok: false,
			error: {
				code: "validation_error",
				message: "sessionRef must be provider-qualified",
			},
		};
	}
	const sessionResult =
		params.mode === "status"
			? await waitForCodingStatus(options.coding, ref, params)
			: { ok: true as const, data: options.coding.resolveSession(ref) };
	if (!sessionResult.ok) {
		return sessionResult;
	}
	const session = sessionResult.data;
	if (!session) {
		return {
			ok: false,
			error: {
				code: "not_found",
				message: `Coding session not found: ${params.sessionRef}`,
			},
		};
	}
	if (params.mode === "status") {
		return {
			ok: true,
			data: await buildCodingStatusData(options.coding, session),
		};
	}
	const events = await options.coding.readEvents(session);
	const selectedEvents = params.full
		? events
		: selectLatestCodingInteractionTurns(events, params.turns ?? 1);
	return {
		ok: true,
		data: {
			mode: "transcript",
			sessionRef: formatNativeSessionRef(session),
			events: selectedEvents,
		},
	};
}

async function cancelCoding(
	options: RuntimeNativeToolHostOptions,
	params: Extract<OutclawCodingParams, { mode: "cancel" }>,
): Promise<NativeToolResult<OutclawCodingData>> {
	if (!options.coding?.cancel) {
		return {
			ok: false,
			error: {
				code: "context_disabled",
				message: "Coding cancel is not configured",
			},
		};
	}
	const ref = parseNativeSessionRef(params.sessionRef);
	if (!ref) {
		return {
			ok: false,
			error: {
				code: "validation_error",
				message: "sessionRef must be provider-qualified",
			},
		};
	}
	try {
		const cancelled = await options.coding.cancel(ref);
		return {
			ok: true,
			data: {
				mode: "cancel",
				sessionRef: formatNativeSessionRef(ref),
				cancelled,
			},
		};
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "provider_failure",
				message: error instanceof Error ? error.message : String(error),
				retryable: true,
			},
		};
	}
}

async function listCoding(
	options: RuntimeNativeToolHostOptions,
	params: Extract<OutclawCodingParams, { mode: "list" }>,
): Promise<NativeToolResult<OutclawCodingData>> {
	if (!options.coding?.list) {
		return {
			ok: false,
			error: {
				code: "context_disabled",
				message: "Coding list is not configured",
			},
		};
	}
	try {
		const result = await options.coding.list({
			...(params.repository === undefined
				? {}
				: { repository: params.repository }),
			...(params.includeArchived === undefined
				? {}
				: { includeArchived: params.includeArchived }),
			...(params.limit === undefined ? {} : { limit: params.limit }),
		});
		return {
			ok: true,
			data: {
				mode: "list",
				repositories: result.repositories.map((repository) => ({
					id: repository.id,
					rootCwd: repository.rootCwd,
					displayName: repository.displayName,
					source: repository.source,
					status: repository.status,
					lastActiveAt: repository.lastActive,
				})),
				sessions: result.sessions.map((session) => ({
					sessionRef: formatNativeSessionRef(session),
					providerId: session.providerId,
					sdkSessionId: session.sdkSessionId,
					...(session.title === undefined ? {} : { title: session.title }),
					status: session.runStatus,
					cwd: session.cwd,
					...(session.repositoryId === undefined
						? {}
						: { repositoryId: session.repositoryId }),
					...(session.linkedChatSessionId === undefined
						? {}
						: { linkedChatSessionId: session.linkedChatSessionId }),
					lastActiveAt: session.lastActive,
				})),
			},
		};
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "provider_failure",
				message: error instanceof Error ? error.message : String(error),
				retryable: true,
			},
		};
	}
}

async function resumeCoding(
	options: RuntimeNativeToolHostOptions,
	params: Extract<OutclawCodingParams, { mode: "resume" }>,
): Promise<NativeToolResult<OutclawCodingData>> {
	if (!options.coding?.resume) {
		return {
			ok: false,
			error: {
				code: "context_disabled",
				message: "Coding resume is not configured",
			},
		};
	}
	const ref = parseNativeSessionRef(params.sessionRef);
	if (!ref) {
		return {
			ok: false,
			error: {
				code: "validation_error",
				message: "sessionRef must be provider-qualified",
			},
		};
	}
	try {
		const result = await options.coding.resume({
			providerId: ref.providerId,
			sdkSessionId: ref.sdkSessionId,
			prompt: params.prompt,
		});
		return {
			ok: true,
			data: {
				mode: "resume",
				sessionRef: formatNativeSessionRef(result),
				status: result.status,
				...(result.turnId === undefined ? {} : { turnId: result.turnId }),
			},
		};
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "provider_failure",
				message: error instanceof Error ? error.message : String(error),
				retryable: true,
			},
		};
	}
}

async function startCoding(
	options: RuntimeNativeToolHostOptions,
	params: Extract<OutclawCodingParams, { mode: "start" }>,
): Promise<NativeToolResult<OutclawCodingData>> {
	if (!options.coding?.start) {
		return {
			ok: false,
			error: {
				code: "context_disabled",
				message: "Coding start is not configured",
			},
		};
	}
	try {
		const linkedChatSession = resolveCurrentChatSession(options);
		const result = await options.coding.start({
			target: params.target,
			prompt: params.prompt,
			...(params.cwd === undefined ? {} : { cwd: params.cwd }),
			...(linkedChatSession === undefined ? {} : { linkedChatSession }),
		});
		return {
			ok: true,
			data: {
				mode: "start",
				sessionRef: formatNativeSessionRef(result),
				status: result.status,
				...(result.turnId === undefined ? {} : { turnId: result.turnId }),
			},
		};
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "provider_failure",
				message: error instanceof Error ? error.message : String(error),
				retryable: true,
			},
		};
	}
}

function resolveCurrentChatSession(
	options: RuntimeNativeToolHostOptions,
): NativeToolLinkedChatSession | undefined {
	if (!options.context.providerSessionRef) {
		return undefined;
	}
	const ref = parseNativeSessionRef(options.context.providerSessionRef);
	if (!ref) {
		return undefined;
	}
	return {
		agentId: options.context.agentId,
		providerId: ref.providerId,
		sdkSessionId: ref.sdkSessionId,
	};
}

async function cron(
	options: RuntimeNativeToolHostOptions,
	params: OutclawCronParams,
): Promise<NativeToolResult<OutclawCronData>> {
	if (params.mode === "failed_status") {
		if (!options.cron) {
			return {
				ok: false,
				error: {
					code: "context_disabled",
					message: "Cron status is not configured",
				},
			};
		}
		const targetAgent = resolveAgent(options, params.agent);
		if (!targetAgent) {
			return {
				ok: false,
				error: {
					code: "not_found",
					message: `Agent not found: ${params.agent ?? options.currentAgentId}`,
				},
			};
		}
		const failures = options.cron.listFailedRuns({
			agentId: targetAgent.agentId,
			...(params.jobName === undefined ? {} : { jobName: params.jobName }),
			...(params.limit === undefined ? {} : { limit: params.limit }),
			...(params.namesOnly === undefined
				? {}
				: { namesOnly: params.namesOnly }),
			...(params.sinceEpochMs === undefined
				? {}
				: { sinceEpochMs: params.sinceEpochMs }),
		});
		return {
			ok: true,
			data: {
				mode: "failed_status",
				failures,
				...(params.namesOnly
					? { jobNames: [...new Set(failures.map((row) => row.jobName))] }
					: {}),
			},
		};
	}
	return await runCronJob(options, params);
}

async function runCronJob(
	options: RuntimeNativeToolHostOptions,
	params: Extract<OutclawCronParams, { mode: "run" }>,
): Promise<NativeToolResult<OutclawCronData>> {
	if (!options.cron?.runJob) {
		return {
			ok: false,
			error: {
				code: "context_disabled",
				message: "Cron run is not configured",
			},
		};
	}
	const targetAgent = resolveAgent(options, params.agent);
	if (!targetAgent) {
		return {
			ok: false,
			error: {
				code: "not_found",
				message: `Agent not found: ${params.agent ?? options.currentAgentId}`,
			},
		};
	}
	try {
		const result = await options.cron.runJob({
			agentId: targetAgent.agentId,
			jobName: params.jobName,
		});
		return {
			ok: true,
			data: {
				mode: "run",
				jobName: params.jobName,
				accepted: result.accepted,
				...(result.sessionRef === undefined
					? {}
					: { sessionRef: result.sessionRef }),
			},
			...(result.message === undefined ? {} : { message: result.message }),
		};
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "provider_failure",
				message: error instanceof Error ? error.message : String(error),
				retryable: true,
			},
		};
	}
}

async function buildCodingStatusData(
	coding: NativeToolCodingReader,
	session: NativeToolCodingSession,
): Promise<Extract<OutclawCodingData, { mode: "status" }>> {
	const base = {
		mode: "status" as const,
		sessionRef: formatNativeSessionRef(session),
		status: normalizeCodingStatus(session.runStatus),
		...(session.title === undefined ? {} : { summary: session.title }),
		...(session.cwd === undefined ? {} : { cwd: session.cwd }),
		...(session.repositoryId === undefined
			? {}
			: { repositoryId: session.repositoryId }),
		...(session.linkedChatSessionId === undefined
			? {}
			: { linkedChatSessionId: session.linkedChatSessionId }),
		...(session.lastActive === undefined
			? {}
			: { lastActiveAt: session.lastActive }),
	};
	if (session.runStatus === "failed") {
		return {
			...base,
			error: session.failureMessage ?? "Coding session failed",
		};
	}
	if (session.runStatus !== "idle") {
		return base;
	}
	return {
		...base,
		...extractCodingStatusFields(await coding.readEvents(session)),
	};
}

function extractCodingStatusFields(
	records: readonly Record<string, unknown>[],
): { lastPrompt?: string; finalResponse?: string } {
	let lastPrompt: string | undefined;
	let finalResponse = "";
	for (const record of records) {
		const event = unwrapCodingEvent(record);
		if (!event) {
			continue;
		}
		if (event.type === "user_prompt") {
			if (typeof event.text === "string") {
				lastPrompt = event.text;
			}
			finalResponse = "";
			continue;
		}
		if (event.type === "text" && typeof event.text === "string") {
			finalResponse += event.text;
		}
	}
	const trimmedResponse = finalResponse.trim();
	return {
		...(lastPrompt === undefined ? {} : { lastPrompt }),
		...(trimmedResponse === "" ? {} : { finalResponse: trimmedResponse }),
	};
}

function selectLatestCodingInteractionTurns(
	records: readonly Record<string, unknown>[],
	turns: number,
): readonly Record<string, unknown>[] {
	const ranges: Array<{ start: number }> = [];
	let activeStart: number | undefined;
	for (const [index, record] of records.entries()) {
		const event = unwrapCodingEvent(record);
		if (event?.type === "user_prompt" && activeStart === undefined) {
			activeStart = index;
			continue;
		}
		if (activeStart !== undefined && isTerminalCodingEvent(event?.type)) {
			ranges.push({ start: activeStart });
			activeStart = undefined;
		}
	}
	if (activeStart !== undefined) {
		ranges.push({ start: activeStart });
	}
	if (ranges.length === 0) {
		return records;
	}
	const selectedTurnIndex = Math.max(0, ranges.length - turns);
	const selectedRange = ranges[selectedTurnIndex];
	return selectedRange ? records.slice(selectedRange.start) : records;
}

function isTerminalCodingEvent(type: unknown): boolean {
	return type === "done" || type === "error" || type === "turn_aborted";
}

function unwrapCodingEvent(
	record: Record<string, unknown>,
): { type?: unknown; text?: unknown } | undefined {
	const nested = record.event;
	if (typeof nested === "object" && nested !== null) {
		return nested as { type?: unknown; text?: unknown };
	}
	return record as { type?: unknown; text?: unknown };
}

function normalizeCodingStatus(
	status: NativeToolCodingSession["runStatus"],
): Extract<OutclawCodingData, { mode: "status" }>["status"] {
	if (status === "idle") {
		return "idle";
	}
	return status;
}

async function waitForCodingStatus(
	coding: NativeToolCodingReader,
	ref: ProviderSessionRef,
	params: Extract<OutclawCodingParams, { mode: "status" }>,
): Promise<NativeToolResult<NativeToolCodingSession | undefined>> {
	const deadline =
		Date.now() +
		(params.timeoutSeconds ?? DEFAULT_CODING_STATUS_TIMEOUT_SECONDS) * 1000;
	let session = coding.resolveSession(ref);
	if (!params.block || session?.runStatus !== "running") {
		return { ok: true, data: session };
	}

	while (Date.now() < deadline) {
		await sleep(CODING_STATUS_POLL_MS);
		session = coding.resolveSession(ref);
		if (session?.runStatus !== "running") {
			return { ok: true, data: session };
		}
	}

	return {
		ok: false,
		error: {
			code: "timeout",
			message: `Coding session ${formatNativeSessionRef(ref)} is still running after ${params.timeoutSeconds ?? DEFAULT_CODING_STATUS_TIMEOUT_SECONDS} seconds`,
			retryable: true,
		},
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function schema(
	options: RuntimeNativeToolHostOptions,
	params: OutclawSchemaParams,
): NativeToolResult<OutclawSchemaData> {
	const targetAgent = resolveAgent(options, params.agent);
	if (!targetAgent) {
		return {
			ok: false,
			error: {
				code: "not_found",
				message: `Agent not found: ${params.agent ?? options.currentAgentId}`,
			},
		};
	}
	try {
		const statuses = selectMemorySchemaStatuses(
			loadMemorySchemaStatuses(targetAgent.memoryRoot),
			params.mode,
		);
		return {
			ok: true,
			data: {
				mode: params.mode,
				schemas: statuses.map((status) => ({
					name: status.name,
					path: status.path,
					...(status.description === undefined
						? {}
						: { description: status.description }),
					...(status.lastObservationAt === undefined
						? {}
						: { lastObservationAt: status.lastObservationAt }),
					...(status.lastSynthesized === undefined
						? {}
						: { lastSynthesized: status.lastSynthesized }),
					status: status.status,
				})),
			},
		};
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "not_found",
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

async function recallTranscript(
	options: RuntimeNativeToolHostOptions,
	params: Extract<OutclawRecallParams, { mode: "transcript" }>,
): Promise<NativeToolResult<OutclawRecallData>> {
	if (!options.sessions?.getSession || !options.readTranscript) {
		return {
			ok: false,
			error: {
				code: "context_disabled",
				message: "Transcript recall is not configured",
			},
		};
	}
	const ref = parseNativeSessionRef(params.sessionRef);
	if (!ref) {
		return {
			ok: false,
			error: {
				code: "validation_error",
				message: "sessionRef must be provider-qualified",
			},
		};
	}
	const targetAgent = resolveAgent(options, params.agent);
	if (!targetAgent) {
		return {
			ok: false,
			error: {
				code: "not_found",
				message: `Agent not found: ${params.agent ?? options.currentAgentId}`,
			},
		};
	}
	const session = options.sessions.getSession({
		agentId: targetAgent.agentId,
		...ref,
		tag: params.tag ?? "chat",
	});
	if (!session) {
		return {
			ok: false,
			error: {
				code: "not_found",
				message: `Session not found: ${params.sessionRef}`,
			},
		};
	}
	const transcript = await options.readTranscript({
		agentId: session.agentId,
		providerId: session.providerId,
		sdkSessionId: session.sdkSessionId,
	});
	if (!transcript) {
		return {
			ok: false,
			error: {
				code: "not_found",
				message: `Transcript not found: ${params.sessionRef}`,
			},
		};
	}
	return {
		ok: true,
		data: {
			mode: "transcript",
			sessionRef: formatNativeSessionRef(session),
			turns:
				params.turns === undefined
					? transcript
					: transcript.slice(-params.turns),
		},
	};
}

function formatNativeSessionRef(ref: ProviderSessionRef): string {
	return formatProviderSessionRef(ref);
}

function resolveAgent(
	options: RuntimeNativeToolHostOptions,
	selector: string | undefined,
): NativeToolAgentInfo | undefined {
	if (selector === undefined) {
		return options.agents.find(
			(agent) => agent.agentId === options.currentAgentId,
		);
	}
	return options.agents.find(
		(agent) => agent.agentId === selector || agent.name === selector,
	);
}

function parseNativeSessionRef(value: string): ProviderSessionRef | undefined {
	const slashIndex = value.indexOf("/");
	if (slashIndex <= 0 || slashIndex === value.length - 1) {
		return undefined;
	}
	return {
		providerId: value.slice(0, slashIndex),
		sdkSessionId: value.slice(slashIndex + 1),
	};
}

class NativeToolTimeoutError extends Error {}

async function askWithOptionalTimeout(
	promise: Promise<string>,
	timeoutSeconds: number | undefined,
): Promise<string> {
	if (timeoutSeconds === undefined) {
		return await promise;
	}
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<string>((_, reject) => {
				timeoutId = setTimeout(
					() => reject(new NativeToolTimeoutError()),
					timeoutSeconds * 1000,
				);
			}),
		]);
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	}
}
