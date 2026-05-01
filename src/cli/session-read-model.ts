import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptTurn } from "../common/protocol.ts";
import { formatTranscriptTurnBody } from "../common/transcript-turn-body.ts";
import type { AgentRecord } from "../runtime/agents/agent-record.ts";
import type { SessionSearchMatch } from "../runtime/persistence/session-query.ts";
import type { SessionRow } from "../runtime/persistence/session-store/session-store.ts";

export function formatSessionList(
	sessions: SessionRow[],
	agents: AgentRecord[],
): string {
	const agentNames = createAgentNameMap(agents);
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

export function formatAmbiguousSessionMatches(
	sessions: SessionRow[],
	agents: AgentRecord[],
): string {
	const agentNames = createAgentNameMap(agents);
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

export function formatSessionTranscript(
	session: SessionRow,
	turns: TranscriptTurn[],
	agents: AgentRecord[],
): string {
	const agentNames = createAgentNameMap(agents);
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

export function formatSessionSearchMatches(
	matches: SessionSearchMatch[],
	agents: AgentRecord[],
): string {
	const agentNames = createAgentNameMap(agents);
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

export function resolveScopedAgent(
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

function createAgentNameMap(agents: AgentRecord[]) {
	return new Map(agents.map((agent) => [agent.agentId, agent.name]));
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
