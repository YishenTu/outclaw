import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createFacadeForProvider } from "../backend/facade-registry.ts";
import type { TranscriptTurn } from "../common/protocol.ts";
import { formatTranscriptTurnBody } from "../common/transcript-turn-body.ts";
import type { AgentRecord } from "../runtime/agents/agent-record.ts";
import { listAgents } from "../runtime/agents/list-agents.ts";
import {
	SessionQuery,
	type SessionResolveResult,
	type SessionSearchMatch,
} from "../runtime/persistence/session-query.ts";
import type { SessionRow } from "../runtime/persistence/session-store.ts";
import type { SessionTag } from "../runtime/persistence/session-store-records.ts";

const HOME_DIR = join(homedir(), ".outclaw");
const DB_PATH = join(HOME_DIR, "db.sqlite");

export async function sessionCommand(argv: string[]) {
	const subcommand = argv[3];
	switch (subcommand) {
		case "list":
			await listSessions(argv.slice(4));
			return;
		case "search":
			await searchSessions(argv.slice(4));
			return;
		case "transcript":
			await showTranscript(argv.slice(4));
			return;
		default:
			printSessionUsage();
			process.exit(1);
	}
}

async function listSessions(args: string[]) {
	const flags = parseFlags(args);
	const limit = parseLimit(flags.limit, 20);
	const tag = parseTag(flags.tag);
	const agents = listAgents(HOME_DIR);
	const scopedAgent = resolveScopedAgent(agents, process.cwd());

	if (!existsSync(DB_PATH)) {
		console.log("No sessions");
		return;
	}

	const query = new SessionQuery(DB_PATH);
	try {
		const sessions = query.list({
			agentId: scopedAgent?.agentId,
			limit,
			tag,
		});
		if (sessions.length === 0) {
			console.log("No sessions");
			return;
		}

		console.log(formatSessionList(sessions, agents));
	} finally {
		query.close();
	}
}

async function searchSessions(args: string[]) {
	const firstFlagIndex = args.findIndex((arg) => arg.startsWith("--"));
	const queryText = (
		firstFlagIndex === -1 ? args : args.slice(0, firstFlagIndex)
	).join(" ");
	if (!queryText.trim()) {
		console.log("Usage: oc session search <query> [--limit N]");
		process.exit(1);
	}

	const flags = parseFlags(
		firstFlagIndex === -1 ? [] : args.slice(firstFlagIndex),
	);
	const limit = parseLimit(flags.limit);
	const agents = listAgents(HOME_DIR);
	const scopedAgent = resolveScopedAgent(agents, process.cwd());

	if (!existsSync(DB_PATH)) {
		console.log("No matches");
		return;
	}

	const query = new SessionQuery(DB_PATH);
	try {
		const matches = query.search({
			agentId: scopedAgent?.agentId,
			limit,
			query: queryText,
			tag: "chat",
		});
		if (matches.length === 0) {
			console.log("No matches");
			return;
		}

		console.log(formatSearchMatches(matches, agents));
	} finally {
		query.close();
	}
}

async function showTranscript(args: string[]) {
	const selector = args[0];
	if (!selector || selector.startsWith("--")) {
		console.log(
			"Usage: oc session transcript <id-or-prefix> [--limit N] [--tag cron]",
		);
		process.exit(1);
	}

	const flags = parseFlags(args.slice(1));
	const limit = parseLimit(flags.limit);
	const tag = parseTag(flags.tag);
	const agents = listAgents(HOME_DIR);
	const scopedAgent = resolveScopedAgent(agents, process.cwd());

	if (!existsSync(DB_PATH)) {
		console.error(`No session matching: ${selector}`);
		process.exit(1);
	}

	const query = new SessionQuery(DB_PATH);
	let resolution: SessionResolveResult;
	try {
		resolution = query.resolve({
			agentId: scopedAgent?.agentId,
			selector,
			tag,
		});
	} finally {
		query.close();
	}

	if (resolution.status === "none") {
		console.error(`No session matching: ${selector}`);
		process.exit(1);
	}
	if (resolution.status === "many") {
		console.error("Multiple sessions match selector:");
		console.error(formatAmbiguousMatches(resolution.matches, agents));
		console.error("Use a longer prefix or the full id.");
		process.exit(1);
	}

	const session = resolution.match;
	const facade = createFacadeForProvider(session.providerId);
	if (!facade?.readTranscript) {
		console.error(
			`Transcript reading is not supported for provider: ${session.providerId}`,
		);
		process.exit(1);
	}

	const transcript = await facade.readTranscript(session.sdkSessionId);
	const turns = limit === undefined ? transcript : transcript.slice(-limit);
	console.log(formatTranscript(session, turns, agents));
}

function formatSessionList(
	sessions: SessionRow[],
	agents: AgentRecord[],
): string {
	const agentNames = new Map(
		agents.map((agent) => [agent.agentId, agent.name]),
	);
	const ids = createDisplayIds(sessions.map((session) => session.sdkSessionId));
	const rows = sessions.map((session, index) =>
		[
			agentNames.get(session.agentId) ?? session.agentId,
			ids[index],
			sanitizeTitle(session.title),
			formatTimestamp(session.createdAt),
			formatTimestamp(session.lastActive),
		].join("\t"),
	);

	return [
		["agent", "id", "title", "created", "last_active"].join("\t"),
		...rows,
	].join("\n");
}

function formatAmbiguousMatches(
	sessions: SessionRow[],
	agents: AgentRecord[],
): string {
	const agentNames = new Map(
		agents.map((agent) => [agent.agentId, agent.name]),
	);
	const ids = createDisplayIds(sessions.map((session) => session.sdkSessionId));
	const rows = sessions.map((session, index) =>
		[
			agentNames.get(session.agentId) ?? session.agentId,
			ids[index],
			sanitizeTitle(session.title),
			formatTimestamp(session.lastActive),
		].join("\t"),
	);

	return [["agent", "id", "title", "last_active"].join("\t"), ...rows].join(
		"\n",
	);
}

function formatTranscript(
	session: SessionRow,
	turns: TranscriptTurn[],
	agents: AgentRecord[],
): string {
	const agentNames = new Map(
		agents.map((agent) => [agent.agentId, agent.name]),
	);
	const lines = [
		`agent: ${agentNames.get(session.agentId) ?? session.agentId}`,
		`id: ${session.sdkSessionId}`,
		`title: ${sanitizeTitle(session.title)}`,
		`tag: ${session.tag}`,
		`created: ${formatTimestamp(session.createdAt)}`,
		`last_active: ${formatTimestamp(session.lastActive)}`,
		"",
	];

	for (const turn of turns) {
		lines.push(`[${turn.role}] ${formatTimestamp(turn.timestamp)}`);
		const body = formatTranscriptTurnBody(turn, {
			includeImagePlaceholders: true,
		});
		if (body) {
			lines.push(body);
		}
		lines.push("");
	}

	if (lines.at(-1) === "") {
		lines.pop();
	}

	return lines.join("\n");
}

function formatSearchMatches(
	matches: SessionSearchMatch[],
	agents: AgentRecord[],
): string {
	const agentNames = new Map(
		agents.map((agent) => [agent.agentId, agent.name]),
	);
	const ids = createDisplayIds(
		matches.map((match) => match.session.sdkSessionId),
	);
	const lines: string[] = [];

	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index];
		const displayId = ids[index] ?? match?.session.sdkSessionId ?? "";
		if (!match) {
			continue;
		}

		const agentName =
			agentNames.get(match.session.agentId) ?? match.session.agentId;
		lines.push(
			`session: ${sanitizeTitle(match.session.title)} (${displayId})`,
			`agent: ${agentName}`,
			`provider: ${match.session.providerId}`,
		);

		for (const turn of match.turns) {
			lines.push(`[${turn.role}] ${formatTimestamp(turn.timestamp)}`);
			lines.push(turn.bodyText, "");
		}

		if (lines.at(-1) === "") {
			lines.pop();
		}
		if (index < matches.length - 1) {
			lines.push("");
		}
	}

	return lines.join("\n");
}

function createDisplayIds(ids: string[]): string[] {
	const lengths = ids.map((id) => Math.min(12, id.length));
	let changed = true;

	while (changed) {
		changed = false;
		const groups = new Map<string, number[]>();
		for (let index = 0; index < ids.length; index += 1) {
			const prefix = ids[index]?.slice(0, lengths[index] ?? 12) ?? "";
			const entries = groups.get(prefix) ?? [];
			entries.push(index);
			groups.set(prefix, entries);
		}

		for (const indexes of groups.values()) {
			if (indexes.length < 2) {
				continue;
			}
			for (const index of indexes) {
				const current = lengths[index] ?? 12;
				const full = ids[index]?.length ?? current;
				if (current < full) {
					lengths[index] = current + 1;
					changed = true;
				}
			}
		}
	}

	return ids.map((id, index) => id.slice(0, lengths[index] ?? 12));
}

function resolveScopedAgent(
	agents: AgentRecord[],
	cwd: string,
): AgentRecord | undefined {
	const agentIdPath = join(cwd, ".agent-id");
	if (!existsSync(agentIdPath)) {
		return undefined;
	}

	const agentId = readFileSync(agentIdPath, "utf-8").trim();
	if (!agentId) {
		return undefined;
	}

	return agents.find((agent) => agent.agentId === agentId);
}

function parseFlags(args: string[]) {
	const flags: Record<string, string> = {};
	for (let index = 0; index < args.length; index += 1) {
		const key = args[index];
		if (!key?.startsWith("--")) {
			continue;
		}
		const value = args[index + 1];
		if (value && !value.startsWith("--")) {
			flags[key.slice(2)] = value;
			index += 1;
			continue;
		}
		flags[key.slice(2)] = "";
	}
	return flags;
}

function parseLimit(
	value: string | undefined,
	defaultValue?: number,
): number | undefined {
	if (value === undefined) {
		return defaultValue;
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		console.error(`Invalid limit: ${value}`);
		process.exit(1);
	}

	return parsed;
}

function parseTag(value: string | undefined): SessionTag {
	if (value === undefined || value === "") {
		return "chat";
	}
	if (value === "cron") {
		return "cron";
	}

	console.error(`Unsupported tag: ${value}`);
	process.exit(1);
}

function sanitizeTitle(title: string): string {
	return title.replaceAll(/\s+/g, " ").trim();
}

function formatTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function printSessionUsage() {
	console.log(
		"Usage: oc session list [--limit N] [--tag cron]\n" +
			"       oc session search <query> [--limit N]\n" +
			"       oc session transcript <id-or-prefix> [--limit N] [--tag cron]",
	);
}
