import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createOutclawLayout } from "../../common/layout.ts";
import {
	parseSchemaFrontmatter,
	readSchemaDateField,
} from "../../runtime/memory/schema-frontmatter.ts";
import {
	formatSchemaStatusUsage,
	hasHelpFlag,
	isHelpFlag,
	printSchemaStatusUsage,
	printSchemaUsage,
} from "../support/usage.ts";

const SCHEMAS_DIR = "schemas";
const SCHEMA_INDEX_FILE = "index.md";

type SchemaCommandMode = "status" | "stale";
type SchemaState = "fresh" | "STALE" | "BROKEN";

export interface SchemaStatusEntry {
	name: string;
	last_observation_at: string | null;
	last_synthesized: string | null;
	state: SchemaState;
	reason?: string;
}

interface SchemaCommandOptions {
	argv: string[];
	homeDir: string;
}

interface ParsedSchemaArgs {
	agent: string | undefined;
	json: boolean;
}

export async function schemaCommand(
	options: SchemaCommandOptions,
): Promise<void> {
	const subcommand = options.argv[3];
	if (subcommand === undefined || isHelpFlag(subcommand)) {
		printSchemaUsage();
		process.exit(subcommand === undefined ? 1 : 0);
	}

	if (subcommand !== "status" && subcommand !== "stale") {
		printSchemaUsage();
		process.exit(1);
	}

	const args = options.argv.slice(4);
	if (hasHelpFlag(args)) {
		printSchemaStatusUsage();
		process.exit(0);
	}

	let parsed: ParsedSchemaArgs;
	try {
		parsed = parseSchemaArgs(args);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.error(formatSchemaStatusUsage());
		process.exit(1);
	}

	try {
		const memoryRoot = resolveSchemaMemoryRoot({
			agentSelector: parsed.agent,
			cwd: process.cwd(),
			homeDir: options.homeDir,
		});
		const statuses = selectSchemaStatuses(
			loadSchemaStatuses(memoryRoot),
			subcommand,
		);
		if (parsed.json) {
			console.log(JSON.stringify(statuses, null, "\t"));
			return;
		}

		const output = formatSchemaStatusRows(statuses);
		if (output.length > 0) {
			console.log(output);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

export function loadSchemaStatuses(memoryRoot: string): SchemaStatusEntry[] {
	const schemasDir = join(memoryRoot, SCHEMAS_DIR);
	let filenames: string[];
	try {
		filenames = readdirSync(schemasDir);
	} catch {
		throw new Error(`oc schema: cannot read schemas directory: ${schemasDir}`);
	}

	const statuses = filenames
		.filter((filename) => filename.endsWith(".md"))
		.filter((filename) => !filename.startsWith("_"))
		.filter((filename) => filename !== SCHEMA_INDEX_FILE)
		.map((filename) => readSchemaStatus(filename, join(schemasDir, filename)));

	return sortSchemaStatuses(statuses);
}

export function selectSchemaStatuses(
	statuses: SchemaStatusEntry[],
	mode: SchemaCommandMode,
): SchemaStatusEntry[] {
	const selected =
		mode === "stale"
			? statuses.filter((status) => status.state !== "fresh")
			: statuses;
	return sortSchemaStatuses(selected);
}

export function formatSchemaStatusRows(statuses: SchemaStatusEntry[]): string {
	if (statuses.length === 0) {
		return "";
	}

	const nameWidth = Math.max(...statuses.map((status) => status.name.length));
	return statuses
		.map((status) => {
			const name = status.name.padEnd(nameWidth);
			const observation = `obs:${status.last_observation_at ?? "?"}`.padEnd(14);
			const synthesized = `syn:${status.last_synthesized ?? "?"}`.padEnd(14);
			const reason = status.reason ? `  (${status.reason})` : "";
			return `${name}  ${observation}  ${synthesized}  ${status.state}${reason}`;
		})
		.join("\n");
}

function readSchemaStatus(
	filename: string,
	filePath: string,
): SchemaStatusEntry {
	let content: string;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch {
		throw new Error(`oc schema: cannot read schema file: ${filePath}`);
	}

	const name = basename(filename, ".md");
	const frontmatter = parseSchemaFrontmatter(content);
	if (frontmatter.status === "missing") {
		return brokenSchema(name, null, null, "missing frontmatter");
	}
	if (frontmatter.status === "unparseable") {
		return brokenSchema(name, null, null, "unparseable frontmatter");
	}

	const observation = readSchemaDateField(
		frontmatter.frontmatter,
		"last_observation_at",
	);
	if (observation.value === null) {
		return brokenSchema(
			name,
			null,
			readSchemaDateField(frontmatter.frontmatter, "last_synthesized").value,
			observation.error,
		);
	}
	const lastObservationAt = observation.value;

	const synthesized = readSchemaDateField(
		frontmatter.frontmatter,
		"last_synthesized",
	);
	if (synthesized.value === null) {
		return brokenSchema(name, lastObservationAt, null, synthesized.error);
	}
	const lastSynthesized = synthesized.value;

	return {
		name,
		last_observation_at: lastObservationAt,
		last_synthesized: lastSynthesized,
		state: lastObservationAt > lastSynthesized ? "STALE" : "fresh",
	};
}

function brokenSchema(
	name: string,
	lastObservationAt: string | null,
	lastSynthesized: string | null,
	reason: string,
): SchemaStatusEntry {
	return {
		name,
		last_observation_at: lastObservationAt,
		last_synthesized: lastSynthesized,
		state: "BROKEN",
		reason,
	};
}

function sortSchemaStatuses(
	statuses: SchemaStatusEntry[],
): SchemaStatusEntry[] {
	return [...statuses].sort((left, right) => {
		const rankDiff = stateRank(left.state) - stateRank(right.state);
		if (rankDiff !== 0) {
			return rankDiff;
		}

		if (left.state === "STALE" && right.state === "STALE") {
			const synthesizedDiff = (left.last_synthesized ?? "").localeCompare(
				right.last_synthesized ?? "",
			);
			if (synthesizedDiff !== 0) {
				return synthesizedDiff;
			}
		}

		return left.name.localeCompare(right.name);
	});
}

function stateRank(state: SchemaState): number {
	if (state === "STALE") return 0;
	if (state === "BROKEN") return 1;
	return 2;
}

function parseSchemaArgs(args: string[]): ParsedSchemaArgs {
	let agent: string | undefined;
	let json = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] ?? "";
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--agent") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("oc schema: --agent requires a value");
			}
			agent = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--")) {
			throw new Error(`oc schema: unknown flag "${arg}"`);
		}
		throw new Error(`oc schema: unexpected argument "${arg}"`);
	}

	return { agent, json };
}

function resolveSchemaMemoryRoot(options: {
	agentSelector: string | undefined;
	cwd: string;
	homeDir: string;
}): string {
	if (options.agentSelector) {
		return resolveAgentBySelector(options.homeDir, options.agentSelector);
	}

	const agentIdPath = join(options.cwd, ".agent-id");
	if (!existsSync(agentIdPath)) {
		throw new Error(
			"oc schema: cannot resolve current agent from cwd (missing .agent-id); use --agent <name|id>",
		);
	}

	const agentId = readFileSync(agentIdPath, "utf-8").trim();
	if (agentId.length === 0) {
		throw new Error(`oc schema: empty agent id in ${agentIdPath}`);
	}
	return options.cwd;
}

function resolveAgentBySelector(homeDir: string, selector: string): string {
	const agentsDir = createOutclawLayout({ homeDir }).agentsDir;
	let entries: Dirent[];
	try {
		entries = readdirSync(agentsDir, { withFileTypes: true });
	} catch {
		throw new Error(`oc schema: cannot read agents directory: ${agentsDir}`);
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const agentHomeDir = join(agentsDir, entry.name);
		if (entry.name === selector) {
			return agentHomeDir;
		}
		const agentId = readAgentId(agentHomeDir);
		if (agentId === selector) {
			return agentHomeDir;
		}
	}

	throw new Error(`oc schema: no agent matching ${selector}`);
}

function readAgentId(agentHomeDir: string): string | undefined {
	try {
		const value = readFileSync(join(agentHomeDir, ".agent-id"), "utf-8").trim();
		return value.length > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}
