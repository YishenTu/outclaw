import {
	type NativeToolResult,
	type NativeToolSafetyClass,
	OUTCLAW_NATIVE_TOOL_CATALOG,
	type OutclawCodingData,
	type OutclawCodingParams,
	type OutclawCronData,
	type OutclawCronParams,
	type OutclawMemoryNoteData,
	type OutclawMemoryNoteParams,
	type OutclawNativeToolContext,
	type OutclawNativeToolHost,
	type OutclawNativeToolName,
	type OutclawPeerMessageData,
	type OutclawPeerMessageParams,
	type OutclawRecallData,
	type OutclawRecallParams,
	type OutclawSchemaData,
	type OutclawSchemaParams,
} from "../../common/native-tools.ts";

export interface OutclawNativeToolHandlers {
	peerMessage?(
		params: OutclawPeerMessageParams,
	): Promise<NativeToolResult<OutclawPeerMessageData>>;
	memoryNote?(
		params: OutclawMemoryNoteParams,
	): Promise<NativeToolResult<OutclawMemoryNoteData>>;
	recall?(
		params: OutclawRecallParams,
	): Promise<NativeToolResult<OutclawRecallData>>;
	schema?(
		params: OutclawSchemaParams,
	): Promise<NativeToolResult<OutclawSchemaData>>;
	cron?(params: OutclawCronParams): Promise<NativeToolResult<OutclawCronData>>;
	coding?(
		params: OutclawCodingParams,
	): Promise<NativeToolResult<OutclawCodingData>>;
}

interface CreateOutclawNativeToolHostOptions {
	context: OutclawNativeToolContext;
	handlers: OutclawNativeToolHandlers;
}

export function createOutclawNativeToolHost(
	options: CreateOutclawNativeToolHostOptions,
): OutclawNativeToolHost {
	return {
		context: options.context,
		peerMessage: (params) =>
			runWithSafety(options, "outclaw_peer_message", params.mode, () =>
				requireHandler(
					options.handlers.peerMessage,
					"outclaw_peer_message",
				)(params),
			),
		memoryNote: (params) =>
			runWithSafety(options, "outclaw_memory_note", undefined, () =>
				requireHandler(
					options.handlers.memoryNote,
					"outclaw_memory_note",
				)(params),
			),
		recall: (params) =>
			runWithSafety(options, "outclaw_recall", params.mode, () =>
				requireHandler(options.handlers.recall, "outclaw_recall")(params),
			),
		schema: (params) =>
			runWithSafety(options, "outclaw_schema", params.mode, () =>
				requireHandler(options.handlers.schema, "outclaw_schema")(params),
			),
		cron: (params) =>
			runWithSafety(options, "outclaw_cron", params.mode, () =>
				requireHandler(options.handlers.cron, "outclaw_cron")(params),
			),
		coding: (params) =>
			runWithSafety(options, "outclaw_coding", params.mode, () =>
				requireHandler(options.handlers.coding, "outclaw_coding")(params),
			),
	};
}

async function runWithSafety<T>(
	options: CreateOutclawNativeToolHostOptions,
	toolName: OutclawNativeToolName,
	mode: string | undefined,
	delegate: () => Promise<NativeToolResult<T>>,
): Promise<NativeToolResult<T>> {
	const safetyClasses = getSafetyClasses(toolName, mode);
	if (options.context.readOnly && hasEffectfulSafetyClass(safetyClasses)) {
		return {
			ok: false,
			error: {
				code: "read_only_violation",
				message: `${toolName}${mode ? ` mode ${mode}` : ""} is disabled in read-only contexts`,
			},
		};
	}
	if (
		options.context.source === "cron" &&
		toolName === "outclaw_cron" &&
		mode === "run"
	) {
		return {
			ok: false,
			error: {
				code: "context_disabled",
				message: "Cron-originated native tool calls cannot trigger cron jobs",
			},
		};
	}
	return delegate();
}

function requireHandler<TParams, TData>(
	handler: ((params: TParams) => Promise<NativeToolResult<TData>>) | undefined,
	toolName: OutclawNativeToolName,
): (params: TParams) => Promise<NativeToolResult<TData>> {
	if (!handler) {
		return async () => ({
			ok: false,
			error: {
				code: "context_disabled",
				message: `${toolName} is not configured in this runtime context`,
			},
		});
	}
	return handler;
}

function getSafetyClasses(
	toolName: OutclawNativeToolName,
	mode: string | undefined,
): readonly NativeToolSafetyClass[] {
	const tool = OUTCLAW_NATIVE_TOOL_CATALOG.find(
		(entry) => entry.name === toolName,
	);
	if (!tool) {
		return [];
	}
	if (!mode) {
		return tool.safetyClasses;
	}
	return (
		tool.modes.find((entry) => entry.name === mode)?.safetyClasses ??
		tool.safetyClasses
	);
}

function hasEffectfulSafetyClass(
	safetyClasses: readonly NativeToolSafetyClass[],
): boolean {
	return safetyClasses.some(
		(safetyClass) =>
			safetyClass === "state-changing" || safetyClass === "long-running",
	);
}
