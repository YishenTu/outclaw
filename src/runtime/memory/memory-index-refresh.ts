import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	parseSchemaDescription,
	parseSchemaFrontmatter,
	readSchemaDateField,
} from "./schema-frontmatter.ts";

const SCHEMAS_DIR = "schemas";
const SCHEMA_INDEX_FILE = "index.md";
const HOT_WINDOW_DAYS = 14;
const WARM_WINDOW_DAYS = 30;
const HOT_SCHEMAS_MARKER_BEGIN = "<!-- hot-schemas:begin -->";
const HOT_SCHEMAS_MARKER_END = "<!-- hot-schemas:end -->";
const WARM_SCHEMAS_MARKER_BEGIN = "<!-- warm-schemas:begin -->";
const WARM_SCHEMAS_MARKER_END = "<!-- warm-schemas:end -->";
const COLD_SCHEMAS_MARKER_BEGIN = "<!-- cold-schemas:begin -->";
const COLD_SCHEMAS_MARKER_END = "<!-- cold-schemas:end -->";
const DEFAULT_SCHEMA_INDEX_TEMPLATE = `# Schema Index

_Start here when you need project-, person-, or topic-specific memory and do not yet know which schema to open._
_Use the tiers as a recency hint, not a priority rule: hot is recent, warm is less recent, cold is older background._

## Hot (<=14d)

These were active recently. Check here first.

<!-- hot-schemas:begin -->
<!-- hot-schemas:end -->

## Warm (15-30d)

These are less fresh, but still recent enough to matter.

<!-- warm-schemas:begin -->
<!-- warm-schemas:end -->

## Cold (>30d)

These are older background schemas. Open them when the topic reaches further back.

<!-- cold-schemas:begin -->
<!-- cold-schemas:end -->
`;

export interface RefreshMemoryIndexOptions {
	memoryRoot: string;
	now?: Date;
}

/**
 * Rewrite `schemas/index.md` from schema frontmatter. The generated buffer is
 * intentionally separate from `MEMORY.md` so the default system prompt stays
 * stable while schema recency metadata can still refresh immediately.
 */
export function refreshMemoryIndex(options: RefreshMemoryIndexOptions): void {
	const schemasDir = join(options.memoryRoot, SCHEMAS_DIR);
	if (!existsSync(schemasDir)) {
		return;
	}

	const indexPath = join(schemasDir, SCHEMA_INDEX_FILE);
	const current = existsSync(indexPath)
		? readFileSync(indexPath, "utf-8")
		: DEFAULT_SCHEMA_INDEX_TEMPLATE;
	const next = renderSchemasIndex(
		current,
		options.memoryRoot,
		options.now ?? new Date(),
	);

	if (current !== next) {
		writeFileSync(indexPath, next);
	}
}

interface SchemaEntry {
	filename: string;
	lastObservationAt: Date;
	description: string;
}

function renderSchemasIndex(
	current: string,
	memoryRoot: string,
	now: Date,
): string {
	const entries = loadSchemaEntries(memoryRoot);
	const hot: SchemaEntry[] = [];
	const warm: SchemaEntry[] = [];
	const cold: SchemaEntry[] = [];

	for (const entry of entries) {
		const ageDays = diffDays(entry.lastObservationAt, now);
		if (ageDays <= HOT_WINDOW_DAYS) {
			hot.push(entry);
			continue;
		}
		if (ageDays <= WARM_WINDOW_DAYS) {
			warm.push(entry);
			continue;
		}
		cold.push(entry);
	}

	for (const group of [hot, warm, cold]) {
		group.sort(
			(a, b) => b.lastObservationAt.getTime() - a.lastObservationAt.getTime(),
		);
	}

	return replaceBlock(
		replaceBlock(
			replaceBlock(
				current,
				HOT_SCHEMAS_MARKER_BEGIN,
				HOT_SCHEMAS_MARKER_END,
				renderTierEntries(hot),
			),
			WARM_SCHEMAS_MARKER_BEGIN,
			WARM_SCHEMAS_MARKER_END,
			renderTierEntries(warm),
		),
		COLD_SCHEMAS_MARKER_BEGIN,
		COLD_SCHEMAS_MARKER_END,
		renderTierEntries(cold),
	);
}

function loadSchemaEntries(memoryRoot: string): SchemaEntry[] {
	const schemasDir = join(memoryRoot, SCHEMAS_DIR);
	const entries: SchemaEntry[] = [];

	for (const name of readdirSync(schemasDir)) {
		if (!name.endsWith(".md")) continue;
		if (name.startsWith("_")) continue;
		if (name === SCHEMA_INDEX_FILE) continue;
		const entry = parseSchemaEntry(name, join(schemasDir, name));
		if (entry) {
			entries.push(entry);
		}
	}

	return entries;
}

function renderTierEntries(entries: SchemaEntry[]): string {
	if (entries.length === 0) {
		return "_None._";
	}

	return entries
		.map((entry) => `- [[${stripMdExtension(entry.filename)}]] — ${entry.description}`)
		.join("\n");
}

function stripMdExtension(filename: string): string {
	return filename.replace(/\.md$/, "");
}

function parseSchemaEntry(
	filename: string,
	filePath: string,
): SchemaEntry | undefined {
	let content: string;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch {
		return undefined;
	}

	const parsed = parseSchemaFrontmatter(content);
	if (parsed.status !== "ok") {
		return undefined;
	}

	const isoDate = readSchemaDateField(
		parsed.frontmatter,
		"last_observation_at",
	).value;
	if (isoDate === null) {
		return undefined;
	}

	const lastObservationAt = parseIsoDate(isoDate);
	if (!lastObservationAt) {
		return undefined;
	}

	return {
		filename,
		lastObservationAt,
		description:
			parseSchemaDescription(parsed.frontmatter) ??
			deriveNameFallback(filename),
	};
}

function deriveNameFallback(filename: string): string {
	return filename.replace(/^schema_/, "").replace(/\.md$/, "");
}

function parseIsoDate(value: string): Date | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return undefined;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(year, month - 1, day);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

function diffDays(earlier: Date, later: Date): number {
	const earlierStart = new Date(
		earlier.getFullYear(),
		earlier.getMonth(),
		earlier.getDate(),
	);
	const laterStart = new Date(
		later.getFullYear(),
		later.getMonth(),
		later.getDate(),
	);
	return Math.floor(
		(laterStart.getTime() - earlierStart.getTime()) / 86_400_000,
	);
}

function replaceBlock(
	content: string,
	begin: string,
	end: string,
	inner: string,
): string {
	const beginIndex = content.indexOf(begin);
	const endIndex = content.indexOf(end);
	if (beginIndex < 0 || endIndex < 0 || endIndex < beginIndex) {
		return content;
	}

	const before = content.slice(0, beginIndex + begin.length);
	const after = content.slice(endIndex);
	const middle = inner.length > 0 ? `\n${inner}\n` : "\n";
	return `${before}${middle}${after}`;
}
