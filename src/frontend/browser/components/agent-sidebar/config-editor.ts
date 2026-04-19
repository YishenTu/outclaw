import type {
	BrowserConfigSchemaNode,
	BrowserConfigSchemaStringFormat,
} from "../../../../common/protocol.ts";

export type ConfigValueKind =
	| "array"
	| "boolean"
	| "null"
	| "number"
	| "object"
	| "string";

export interface ConfigEntry {
	allowedValueKinds?: ConfigValueKind[];
	displayItem?: string;
	item: string;
	stringFormat?: BrowserConfigSchemaStringFormat;
	typeLabel?: string;
	value: string;
	valueKind: ConfigValueKind;
}

export type ConfigDocument = Record<string, unknown>;

interface ParseConfigEntriesOptions {
	agentNamesById?: Record<string, string>;
	schema?: BrowserConfigSchemaNode;
}

export function parseConfigDocument(content: string): ConfigDocument {
	const parsed = JSON.parse(content) as unknown;
	if (!isPlainObject(parsed)) {
		throw new Error("Config file must contain a JSON object");
	}
	return parsed;
}

export function parseConfigEntries(
	value: unknown,
	options?: ParseConfigEntriesOptions,
): ConfigEntry[] {
	const entries: ConfigEntry[] = [];
	collectConfigEntries(value, "", entries, options, options?.schema);
	return entries;
}

export function applyConfigEntryEdits(
	document: ConfigDocument,
	entries: ConfigEntry[],
): ConfigDocument {
	const nextDocument = structuredClone(document);

	for (const entry of entries) {
		setConfigValue(nextDocument, tokenizeConfigPath(entry.item), entry);
	}

	return nextDocument;
}

function collectConfigEntries(
	value: unknown,
	path: string,
	entries: ConfigEntry[],
	options?: ParseConfigEntriesOptions,
	schema?: BrowserConfigSchemaNode,
): void {
	if (schema?.kind === "leaf") {
		const actualValueKind = classifyConfigValueKind(value);
		entries.push({
			allowedValueKinds: uniqueConfigValueKinds([
				...schema.editorKinds,
				actualValueKind,
			]),
			displayItem: toDisplayItem(path || "$", options),
			item: path || "$",
			stringFormat: schema.stringFormat,
			typeLabel: schema.typeLabel,
			value: formatLeafConfigValue(value),
			valueKind: actualValueKind,
		});
		return;
	}

	if (Array.isArray(value)) {
		if (value.length === 0) {
			entries.push({
				displayItem: toDisplayItem(path || "$", options),
				item: path || "$",
				value: "[]",
				valueKind: "array",
			});
			return;
		}

		for (const [index, child] of value.entries()) {
			collectConfigEntries(
				child,
				`${path}[${index}]`,
				entries,
				options,
				undefined,
			);
		}
		return;
	}

	if (isPlainObject(value)) {
		const objectEntries = Object.entries(value);
		if (objectEntries.length === 0) {
			entries.push({
				displayItem: toDisplayItem(path || "$", options),
				item: path || "$",
				value: "{}",
				valueKind: "object",
			});
			return;
		}

		for (const [key, child] of objectEntries) {
			const childSchema =
				schema?.kind === "object"
					? (schema.properties?.[key] ?? schema.additionalProperties)
					: undefined;
			collectConfigEntries(
				child,
				path ? `${path}.${key}` : key,
				entries,
				options,
				childSchema,
			);
		}
		return;
	}

	entries.push({
		displayItem: toDisplayItem(path || "$", options),
		item: path || "$",
		typeLabel: undefined,
		value: formatConfigValue(value),
		valueKind: classifyConfigValueKind(value),
	});
}

function toDisplayItem(
	path: string,
	options?: ParseConfigEntriesOptions,
): string {
	const agentNamesById = options?.agentNamesById;
	if (!agentNamesById || !path.startsWith("agents.")) {
		return path;
	}

	const match = path.match(/^agents\.([^.[\]]+)(.*)$/);
	if (!match) {
		return path;
	}

	const [, agentId, suffix] = match;
	if (!agentId) {
		return path;
	}

	const agentName = agentNamesById[agentId];
	if (!agentName) {
		return path;
	}

	return `agents.${agentName}${suffix ?? ""}`;
}

function formatConfigValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value) || isPlainObject(value)) {
		return JSON.stringify(value, null, "\t");
	}
	return String(value);
}

function formatLeafConfigValue(value: unknown): string {
	return formatConfigValue(value);
}

function classifyConfigValueKind(value: unknown): ConfigValueKind {
	if (typeof value === "string") {
		return "string";
	}
	if (typeof value === "number") {
		return "number";
	}
	if (typeof value === "boolean") {
		return "boolean";
	}
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return "array";
	}
	if (isPlainObject(value)) {
		return "object";
	}
	return "string";
}

function tokenizeConfigPath(path: string): Array<string | number> {
	if (path.trim() === "") {
		throw new Error("Config path is required");
	}

	const tokens: Array<string | number> = [];
	let currentKey = "";
	for (let index = 0; index < path.length; index += 1) {
		const character = path[index];
		if (character === ".") {
			pushKeyToken(tokens, currentKey);
			currentKey = "";
			continue;
		}
		if (character === "[") {
			pushKeyToken(tokens, currentKey);
			currentKey = "";
			const endIndex = path.indexOf("]", index);
			if (endIndex === -1) {
				throw new Error(`Invalid config path: ${path}`);
			}
			const arrayIndex = Number.parseInt(path.slice(index + 1, endIndex), 10);
			if (!Number.isInteger(arrayIndex)) {
				throw new Error(`Invalid config path: ${path}`);
			}
			tokens.push(arrayIndex);
			index = endIndex;
			continue;
		}
		currentKey += character;
	}

	pushKeyToken(tokens, currentKey);
	if (tokens.length === 0) {
		throw new Error(`Invalid config path: ${path}`);
	}
	return tokens;
}

function pushKeyToken(tokens: Array<string | number>, key: string) {
	if (key !== "") {
		tokens.push(key);
	}
}

function setConfigValue(
	document: ConfigDocument,
	path: Array<string | number>,
	entry: ConfigEntry,
) {
	let current: unknown = document;
	for (const token of path.slice(0, -1)) {
		if (typeof token === "number") {
			if (!Array.isArray(current) || current[token] === undefined) {
				throw new Error(`Missing config path: ${entry.item}`);
			}
			current = current[token];
			continue;
		}

		if (!isPlainObject(current) || !(token in current)) {
			throw new Error(`Missing config path: ${entry.item}`);
		}
		current = current[token];
	}

	const lastToken = path[path.length - 1];
	if (lastToken === undefined) {
		throw new Error(`Missing config path: ${entry.item}`);
	}
	const nextValue = parseEditedConfigValue(entry);
	if (typeof lastToken === "number") {
		if (!Array.isArray(current)) {
			throw new Error(`Missing config path: ${entry.item}`);
		}
		current[lastToken] = nextValue;
		return;
	}

	if (!isPlainObject(current)) {
		throw new Error(`Missing config path: ${entry.item}`);
	}
	if (typeof lastToken !== "string") {
		throw new Error(`Missing config path: ${entry.item}`);
	}
	current[lastToken] = nextValue;
}

function parseEditedConfigValue(entry: ConfigEntry): unknown {
	const allowedValueKinds = uniqueConfigValueKinds([
		...(entry.allowedValueKinds ?? []),
		entry.valueKind,
	]);
	if (allowedValueKinds.length === 1) {
		const [valueKind] = allowedValueKinds;
		if (!valueKind) {
			throw new Error(`Invalid config type for ${entry.item}`);
		}
		return parseEditedConfigValueByKind(entry, valueKind);
	}

	return parseEditedUnionConfigValue(entry, allowedValueKinds);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEditedUnionConfigValue(
	entry: ConfigEntry,
	allowedValueKinds: ConfigValueKind[],
): unknown {
	const trimmed = entry.value.trim();
	if (allowedValueKinds.includes("array") && looksLikeJsonArray(trimmed)) {
		return parseEditedConfigValueByKind(entry, "array");
	}
	if (allowedValueKinds.includes("object") && looksLikeJsonObject(trimmed)) {
		return parseEditedConfigValueByKind(entry, "object");
	}
	if (
		allowedValueKinds.includes("boolean") &&
		(trimmed === "true" || trimmed === "false")
	) {
		return parseEditedConfigValueByKind(entry, "boolean");
	}
	if (allowedValueKinds.includes("null") && trimmed === "null") {
		return parseEditedConfigValueByKind(entry, "null");
	}
	if (allowedValueKinds.includes("number") && looksLikeNumberLiteral(trimmed)) {
		return parseEditedConfigValueByKind(entry, "number");
	}
	if (allowedValueKinds.includes("string")) {
		return parseEditedConfigValueByKind(entry, "string");
	}
	if (allowedValueKinds.includes("array")) {
		return parseEditedConfigValueByKind(entry, "array");
	}
	if (allowedValueKinds.includes("object")) {
		return parseEditedConfigValueByKind(entry, "object");
	}

	throw new Error(`Unsupported config type for ${entry.item}`);
}

function parseEditedConfigValueByKind(
	entry: ConfigEntry,
	valueKind: ConfigValueKind,
): unknown {
	const trimmed = entry.value.trim();
	if (valueKind === "string") {
		return validateEditedStringValue(entry, entry.value);
	}
	if (valueKind === "number") {
		if (trimmed === "") {
			throw new Error(`Invalid number for ${entry.item}`);
		}
		const parsed = Number(trimmed);
		if (!Number.isFinite(parsed)) {
			throw new Error(`Invalid number for ${entry.item}`);
		}
		return parsed;
	}
	if (valueKind === "boolean") {
		if (trimmed === "true") {
			return true;
		}
		if (trimmed === "false") {
			return false;
		}
		throw new Error(`Invalid boolean for ${entry.item}`);
	}
	if (valueKind === "null") {
		if (trimmed === "null") {
			return null;
		}
		throw new Error(`Invalid null literal for ${entry.item}`);
	}

	try {
		const parsed = JSON.parse(entry.value) as unknown;
		if (valueKind === "array") {
			if (!Array.isArray(parsed)) {
				throw new Error(`Config value must remain an array for ${entry.item}`);
			}
			return parsed;
		}
		if (!isPlainObject(parsed)) {
			throw new Error(`Config value must remain an object for ${entry.item}`);
		}
		return parsed;
	} catch (error) {
		throw new Error(
			error instanceof Error ? error.message : `Invalid JSON for ${entry.item}`,
		);
	}
}

function looksLikeJsonArray(value: string): boolean {
	return value.startsWith("[");
}

function looksLikeJsonObject(value: string): boolean {
	return value.startsWith("{");
}

function looksLikeNumberLiteral(value: string): boolean {
	return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(value);
}

function uniqueConfigValueKinds(kinds: ConfigValueKind[]): ConfigValueKind[] {
	return [...new Set(kinds)];
}

function validateEditedStringValue(entry: ConfigEntry, value: string): string {
	if (
		entry.stringFormat === "env_ref" &&
		!isEnvironmentVariableReference(value)
	) {
		throw new Error(
			`Expected environment variable reference like $NAME for ${entry.item}`,
		);
	}
	return value;
}

function isEnvironmentVariableReference(value: string): boolean {
	return /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
