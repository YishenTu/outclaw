import {
	type NativeToolContract,
	type NativeToolResult,
	OUTCLAW_NATIVE_TOOL_CATALOG,
	type OutclawCodingParams,
	type OutclawCronParams,
	type OutclawMemoryNoteParams,
	type OutclawNativeToolHost,
	type OutclawNativeToolName,
	type OutclawPeerMessageParams,
	type OutclawRecallParams,
	type OutclawSchemaParams,
	validateOutclawNativeToolParams,
} from "../../../common/native-tools.ts";

type PiSdkModule = typeof import("@earendil-works/pi-coding-agent");
type PiToolDefinition = ReturnType<PiSdkModule["defineTool"]>;
type NativeToolJsonSchema = Record<string, unknown>;

interface OutclawNativePiToolSdk {
	defineTool: PiSdkModule["defineTool"];
}

type OutclawNativePiContract = NativeToolContract & {
	readonly name: OutclawNativeToolName;
};

export function createOutclawNativePiTools(
	sdk: OutclawNativePiToolSdk,
	host: OutclawNativeToolHost,
	options: { readOnly?: boolean } = {},
): PiToolDefinition[] {
	const catalog: readonly OutclawNativePiContract[] =
		OUTCLAW_NATIVE_TOOL_CATALOG;
	const contracts: readonly OutclawNativePiContract[] = options.readOnly
		? catalog.flatMap((contract) => {
				const readOnlyContract = filterReadOnlyNativeToolContract(contract);
				return readOnlyContract ? [readOnlyContract] : [];
			})
		: catalog;
	return contracts.map((contract) =>
		sdk.defineTool({
			name: contract.name,
			label: nativeToolLabel(contract.name),
			description: contract.description,
			promptSnippet: contract.description,
			promptGuidelines: [
				"Pass structured JSON parameters matching the documented mode.",
				"Do not call shell commands for Outclaw workflows when a native Outclaw tool exists.",
			],
			parameters: nativeToolParameterSchema(
				contract.name,
				contract.modes.map((mode) => mode.name),
				{ readOnly: options.readOnly },
			),
			async execute(_toolCallId, params) {
				const result = await callNativeHost(host, contract.name, params);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(result),
						},
					],
					details: result,
				};
			},
		}),
	);
}

function filterReadOnlyNativeToolContract(
	contract: OutclawNativePiContract,
): OutclawNativePiContract | undefined {
	if (contract.safetyClasses.includes("read-only")) {
		return contract;
	}
	const modes = contract.modes.filter((mode) =>
		mode.safetyClasses.includes("read-only"),
	);
	if (modes.length === 0) {
		return undefined;
	}
	return {
		...contract,
		description: [
			`Use when: ${nativeToolLabel(contract.name)} read-only operations are needed in this context.`,
			`Modes: ${modes.map((mode) => mode.name).join(", ")}.`,
			"Safety: read-only only; state-changing and long-running modes are hidden in this session.",
			"Do not use when: the task needs unavailable modes.",
		].join(" "),
		modes,
	};
}

async function callNativeHost(
	host: OutclawNativeToolHost,
	toolName: OutclawNativeToolName,
	params: unknown,
): Promise<NativeToolResult<unknown>> {
	const validation = validateOutclawNativeToolParams(toolName, params);
	if (!validation.ok) {
		return validation;
	}

	switch (toolName) {
		case "outclaw_peer_message":
			return await host.peerMessage(
				validation.data as OutclawPeerMessageParams,
			);
		case "outclaw_memory_note":
			return await host.memoryNote(validation.data as OutclawMemoryNoteParams);
		case "outclaw_recall":
			return await host.recall(validation.data as OutclawRecallParams);
		case "outclaw_schema":
			return await host.schema(validation.data as OutclawSchemaParams);
		case "outclaw_cron":
			return await host.cron(validation.data as OutclawCronParams);
		case "outclaw_coding":
			return await host.coding(validation.data as OutclawCodingParams);
	}
}

function nativeToolLabel(toolName: OutclawNativeToolName): string {
	return toolName
		.replace(/^outclaw_/, "Outclaw ")
		.replace(/_/g, " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nativeToolParameterSchema(
	toolName: OutclawNativeToolName,
	modes?: readonly string[],
	options: { readOnly?: boolean } = {},
): never {
	switch (toolName) {
		case "outclaw_memory_note":
			return objectSchema(["text"], {
				text: stringSchema(),
				salience: enumSchema([
					"correction",
					"confirmation",
					"decision",
					"surprise",
					"routine",
				]),
				title: stringSchema(),
				tags: arraySchema(stringSchema()),
			}) as never;
		case "outclaw_peer_message":
			return nativeModeObjectSchema(
				toolName,
				modes ?? ["list", "ask", "send"],
				{
					targetAgent: stringSchema(),
					message: stringSchema(),
					timeoutSeconds: numberSchema(),
				},
			) as never;
		case "outclaw_recall":
			return nativeModeObjectSchema(
				toolName,
				modes ?? ["sessions", "transcript"],
				{
					query: stringSchema(),
					agent: stringSchema(),
					allAgents: booleanSchema(),
					limit: numberSchema(),
					cursor: stringSchema(),
					tag: enumSchema(["chat", "cron"]),
					sessionRef: stringSchema(),
					turns: numberSchema(),
					full: booleanSchema(),
					includeEmpty: booleanSchema(),
				},
			) as never;
		case "outclaw_schema":
			return nativeModeObjectSchema(toolName, modes ?? ["all", "stale"], {
				agent: stringSchema(),
			}) as never;
		case "outclaw_cron":
			return nativeModeObjectSchema(
				toolName,
				modes ?? ["failed_status", "run"],
				{
					agent: stringSchema(),
					jobName: stringSchema(),
					namesOnly: booleanSchema(),
					sinceEpochMs: numberSchema(),
					limit: numberSchema(),
				},
			) as never;
		case "outclaw_coding":
			return nativeModeObjectSchema(
				toolName,
				modes ?? ["list", "start", "resume", "status", "transcript", "cancel"],
				{
					repository: stringSchema(),
					includeArchived: booleanSchema(),
					limit: numberSchema(),
					target: stringSchema(),
					prompt: stringSchema(),
					cwd: stringSchema(),
					sessionRef: stringSchema(),
					block: booleanSchema(),
					timeoutSeconds: numberSchema(),
					turns: numberSchema(),
					full: booleanSchema(),
					cursor: stringSchema(),
					eventTypes: arraySchema(stringSchema()),
					includeToolOutputs: booleanSchema(),
				},
				options.readOnly ? ["block", "timeoutSeconds"] : [],
			) as never;
	}
}

function nativeModeObjectSchema(
	toolName: OutclawNativeToolName,
	modes: readonly string[],
	properties: Record<string, NativeToolJsonSchema>,
	hiddenProperties: readonly string[] = [],
): NativeToolJsonSchema {
	const allowedProperties = new Set(
		modes.flatMap((mode) => nativeModePropertyNames(toolName, mode)),
	);
	for (const hiddenProperty of hiddenProperties) {
		allowedProperties.delete(hiddenProperty);
	}
	return modeObjectSchema(
		modes,
		Object.fromEntries(
			Object.entries(properties).filter(([propertyName]) =>
				allowedProperties.has(propertyName),
			),
		),
	);
}

function nativeModePropertyNames(
	toolName: OutclawNativeToolName,
	mode: string,
): readonly string[] {
	switch (toolName) {
		case "outclaw_memory_note":
			return ["text", "salience", "title", "tags"];
		case "outclaw_peer_message":
			return mode === "list"
				? []
				: ["targetAgent", "message", "timeoutSeconds"];
		case "outclaw_recall":
			return mode === "sessions"
				? ["query", "agent", "allAgents", "limit", "cursor", "tag"]
				: [
						"sessionRef",
						"agent",
						"turns",
						"full",
						"includeEmpty",
						"cursor",
						"tag",
					];
		case "outclaw_schema":
			return ["agent"];
		case "outclaw_cron":
			return mode === "failed_status"
				? ["agent", "jobName", "namesOnly", "sinceEpochMs", "limit"]
				: ["agent", "jobName"];
		case "outclaw_coding":
			switch (mode) {
				case "list":
					return ["repository", "includeArchived", "limit"];
				case "start":
					return ["target", "prompt", "cwd"];
				case "resume":
					return ["sessionRef", "prompt"];
				case "status":
					return ["sessionRef", "block", "timeoutSeconds"];
				case "transcript":
					return [
						"sessionRef",
						"turns",
						"full",
						"cursor",
						"eventTypes",
						"includeToolOutputs",
					];
				case "cancel":
					return ["sessionRef"];
				default:
					return [];
			}
	}
}

function modeObjectSchema(
	modes: readonly string[],
	properties: Record<string, NativeToolJsonSchema>,
): NativeToolJsonSchema {
	return objectSchema(["mode"], {
		mode: enumSchema(modes),
		...properties,
	});
}

function objectSchema(
	required: string[],
	properties: Record<string, NativeToolJsonSchema>,
): NativeToolJsonSchema {
	return {
		type: "object",
		additionalProperties: false,
		required,
		properties,
	};
}

function stringSchema(): NativeToolJsonSchema {
	return { type: "string" };
}

function numberSchema(): NativeToolJsonSchema {
	return { type: "number" };
}

function booleanSchema(): NativeToolJsonSchema {
	return { type: "boolean" };
}

function enumSchema(values: readonly string[]): NativeToolJsonSchema {
	return { type: "string", enum: [...values] };
}

function arraySchema(items: NativeToolJsonSchema): NativeToolJsonSchema {
	return { type: "array", items };
}
