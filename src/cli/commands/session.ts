import { existsSync } from "node:fs";
import { createFacadeForProvider } from "../../backend/facade-registry.ts";
import { createOutclawLayout } from "../../common/layout.ts";
import { listAgents } from "../../runtime/agents/list-agents.ts";
import {
	SessionQuery,
	type SessionResolveResult,
} from "../../runtime/persistence/session-query.ts";
import type { SessionTag } from "../../runtime/persistence/session-store/session-store-records.ts";
import { parseFlagValues } from "../support/argv.ts";
import {
	formatAmbiguousSessionMatches,
	formatSessionList,
	formatSessionSearchMatches,
	formatSessionTranscript,
	resolveScopedAgent,
} from "../support/session-read-model.ts";
import {
	formatSessionSearchUsage,
	formatSessionTranscriptUsage,
	hasHelpFlag,
	isHelpFlag,
	printSessionListUsage,
	printSessionSearchUsage,
	printSessionTranscriptUsage,
	printSessionUsage,
} from "../support/usage.ts";

const layout = createOutclawLayout();

export async function sessionCommand(argv: string[]) {
	const subcommand = argv[3];
	if (subcommand === undefined || isHelpFlag(subcommand)) {
		printSessionUsage();
		process.exit(subcommand === undefined ? 1 : 0);
	}

	switch (subcommand) {
		case "list":
			if (hasHelpFlag(argv.slice(4))) {
				printSessionListUsage();
				process.exit(0);
			}
			await listSessions(argv.slice(4));
			return;
		case "search":
			if (hasHelpFlag(argv.slice(4))) {
				printSessionSearchUsage();
				process.exit(0);
			}
			await searchSessions(argv.slice(4));
			return;
		case "transcript":
			if (hasHelpFlag(argv.slice(4))) {
				printSessionTranscriptUsage();
				process.exit(0);
			}
			await showTranscript(argv.slice(4));
			return;
		default:
			printSessionUsage();
			process.exit(1);
	}
}

async function listSessions(args: string[]) {
	const flags = parseFlagValues(args);
	const limit = parseLimit(flags.limit, 20);
	const tag = parseTag(flags.tag);
	const agents = listAgents(layout.homeDir);
	const scopedAgent = resolveScopedAgent(agents, process.cwd());

	if (!existsSync(layout.dbPath)) {
		console.log("No sessions");
		return;
	}

	const query = new SessionQuery(layout.dbPath);
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
		console.error(formatSessionSearchUsage());
		process.exit(1);
	}

	const flags = parseFlagValues(
		firstFlagIndex === -1 ? [] : args.slice(firstFlagIndex),
	);
	const limit = parseLimit(flags.limit);
	const agents = listAgents(layout.homeDir);
	const scopedAgent = resolveScopedAgent(agents, process.cwd());

	if (!existsSync(layout.dbPath)) {
		console.log("No matches");
		return;
	}

	const query = new SessionQuery(layout.dbPath);
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

		console.log(formatSessionSearchMatches(matches, agents));
	} finally {
		query.close();
	}
}

async function showTranscript(args: string[]) {
	const selector = args[0];
	if (!selector || selector.startsWith("--")) {
		console.error(formatSessionTranscriptUsage());
		process.exit(1);
	}

	const flags = parseFlagValues(args.slice(1));
	const limit = parseLimit(flags.limit);
	const tag = parseTag(flags.tag);
	const agents = listAgents(layout.homeDir);
	const scopedAgent = resolveScopedAgent(agents, process.cwd());

	if (!existsSync(layout.dbPath)) {
		console.error(`No session matching: ${selector}`);
		process.exit(1);
	}

	const query = new SessionQuery(layout.dbPath);
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
		console.error(formatAmbiguousSessionMatches(resolution.matches, agents));
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
	console.log(formatSessionTranscript(session, turns, agents));
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
