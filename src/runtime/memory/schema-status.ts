import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
	parseSchemaDescription,
	parseSchemaFrontmatter,
	readSchemaDateField,
} from "./schema-frontmatter.ts";

const SCHEMAS_DIR = "schemas";
const SCHEMA_INDEX_FILE = "index.md";

export type MemorySchemaStatus = "fresh" | "stale" | "unknown";

export interface MemorySchemaStatusEntry {
	name: string;
	path: string;
	description?: string;
	lastObservationAt?: string;
	lastSynthesized?: string;
	status: MemorySchemaStatus;
	reason?: string;
}

export function loadMemorySchemaStatuses(
	memoryRoot: string,
): MemorySchemaStatusEntry[] {
	const schemasDir = join(memoryRoot, SCHEMAS_DIR);
	let filenames: string[];
	try {
		filenames = readdirSync(schemasDir);
	} catch {
		throw new Error(`Cannot read schemas directory: ${schemasDir}`);
	}

	return sortMemorySchemaStatuses(
		filenames
			.filter((filename) => filename.endsWith(".md"))
			.filter((filename) => !filename.startsWith("_"))
			.filter((filename) => filename !== SCHEMA_INDEX_FILE)
			.map((filename) =>
				readMemorySchemaStatus(filename, join(schemasDir, filename)),
			),
	);
}

export function selectMemorySchemaStatuses(
	statuses: readonly MemorySchemaStatusEntry[],
	mode: "all" | "stale",
): MemorySchemaStatusEntry[] {
	return sortMemorySchemaStatuses(
		mode === "stale"
			? statuses.filter((status) => status.status !== "fresh")
			: statuses,
	);
}

function readMemorySchemaStatus(
	filename: string,
	filePath: string,
): MemorySchemaStatusEntry {
	let content: string;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch {
		throw new Error(`Cannot read schema file: ${filePath}`);
	}

	const name = basename(filename, ".md");
	const frontmatter = parseSchemaFrontmatter(content);
	if (frontmatter.status === "missing") {
		return unknownSchema(name, filePath, "missing frontmatter");
	}
	if (frontmatter.status === "unparseable") {
		return unknownSchema(name, filePath, "unparseable frontmatter");
	}

	const description = parseSchemaDescription(frontmatter.frontmatter);
	const observation = readSchemaDateField(
		frontmatter.frontmatter,
		"last_observation_at",
	);
	const synthesized = readSchemaDateField(
		frontmatter.frontmatter,
		"last_synthesized",
	);
	if (observation.value === null || synthesized.value === null) {
		return {
			name,
			path: filePath,
			...(description === undefined ? {} : { description }),
			...(observation.value === null
				? {}
				: { lastObservationAt: observation.value }),
			...(synthesized.value === null
				? {}
				: { lastSynthesized: synthesized.value }),
			status: "unknown",
			reason: observation.error ?? synthesized.error,
		};
	}

	return {
		name,
		path: filePath,
		...(description === undefined ? {} : { description }),
		lastObservationAt: observation.value,
		lastSynthesized: synthesized.value,
		status: observation.value > synthesized.value ? "stale" : "fresh",
	};
}

function unknownSchema(
	name: string,
	path: string,
	reason: string,
): MemorySchemaStatusEntry {
	return {
		name,
		path,
		status: "unknown",
		reason,
	};
}

function sortMemorySchemaStatuses(
	statuses: readonly MemorySchemaStatusEntry[],
): MemorySchemaStatusEntry[] {
	return [...statuses].sort((left, right) => {
		const rankDiff = statusRank(left.status) - statusRank(right.status);
		if (rankDiff !== 0) {
			return rankDiff;
		}
		if (left.status === "stale" && right.status === "stale") {
			const synthesizedDiff = (left.lastSynthesized ?? "").localeCompare(
				right.lastSynthesized ?? "",
			);
			if (synthesizedDiff !== 0) {
				return synthesizedDiff;
			}
		}
		return left.name.localeCompare(right.name);
	});
}

function statusRank(status: MemorySchemaStatus): number {
	if (status === "stale") return 0;
	if (status === "unknown") return 1;
	return 2;
}
