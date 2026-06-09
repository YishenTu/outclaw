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
	type OutclawNativeToolParams,
	type OutclawPeerMessageData,
	type OutclawPeerMessageParams,
	type OutclawRecallData,
	type OutclawRecallParams,
	type OutclawSchemaData,
	type OutclawSchemaParams,
	validateOutclawNativeToolParams,
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
			runValidated<OutclawPeerMessageParams, OutclawPeerMessageData>(
				options,
				"outclaw_peer_message",
				params,
				(validated) => validated.mode,
				requireHandler(options.handlers.peerMessage, "outclaw_peer_message"),
			),
		memoryNote: (params) =>
			runValidated<OutclawMemoryNoteParams, OutclawMemoryNoteData>(
				options,
				"outclaw_memory_note",
				params,
				() => undefined,
				requireHandler(options.handlers.memoryNote, "outclaw_memory_note"),
			),
		recall: (params) =>
			runValidated<OutclawRecallParams, OutclawRecallData>(
				options,
				"outclaw_recall",
				params,
				(validated) => validated.mode,
				requireHandler(options.handlers.recall, "outclaw_recall"),
			),
		schema: (params) =>
			runValidated<OutclawSchemaParams, OutclawSchemaData>(
				options,
				"outclaw_schema",
				params,
				(validated) => validated.mode,
				requireHandler(options.handlers.schema, "outclaw_schema"),
			),
		cron: (params) =>
			runValidated<OutclawCronParams, OutclawCronData>(
				options,
				"outclaw_cron",
				params,
				(validated) => validated.mode,
				requireHandler(options.handlers.cron, "outclaw_cron"),
			),
		coding: (params) =>
			runValidated<OutclawCodingParams, OutclawCodingData>(
				options,
				"outclaw_coding",
				params,
				(validated) => validated.mode,
				requireHandler(options.handlers.coding, "outclaw_coding"),
			),
	};
}

async function runValidated<TParams extends OutclawNativeToolParams, TData>(
	options: CreateOutclawNativeToolHostOptions,
	toolName: OutclawNativeToolName,
	params: unknown,
	resolveMode: (params: TParams) => string | undefined,
	delegate: (params: TParams) => Promise<NativeToolResult<TData>>,
): Promise<NativeToolResult<TData>> {
	const validation = validateOutclawNativeToolParams(toolName, params);
	if (!validation.ok) {
		return {
			ok: false,
			error: validation.error,
		};
	}
	const validatedParams = validation.data as TParams;
	const mode = resolveMode(validatedParams);
	return runWithSafety(
		options,
		toolName,
		mode,
		getEffectiveSafetyClasses(toolName, mode, validatedParams),
		() => delegate(validatedParams),
	);
}

async function runWithSafety<T>(
	options: CreateOutclawNativeToolHostOptions,
	toolName: OutclawNativeToolName,
	mode: string | undefined,
	safetyClasses: readonly NativeToolSafetyClass[],
	delegate: () => Promise<NativeToolResult<T>>,
): Promise<NativeToolResult<T>> {
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

function getEffectiveSafetyClasses(
	toolName: OutclawNativeToolName,
	mode: string | undefined,
	params: OutclawNativeToolParams,
): readonly NativeToolSafetyClass[] {
	const safetyClasses = getSafetyClasses(toolName, mode);
	if (
		toolName === "outclaw_coding" &&
		mode === "status" &&
		"block" in params &&
		params.block === true
	) {
		return [
			...new Set<NativeToolSafetyClass>([...safetyClasses, "long-running"]),
		];
	}
	return safetyClasses;
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
