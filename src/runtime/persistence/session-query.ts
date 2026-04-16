import { Database } from "bun:sqlite";
import {
	mapSessionRows,
	type SessionRow,
	type SessionTag,
} from "./session-store-records.ts";
import { ensureSessionStoreSchema } from "./session-store-schema.ts";

interface SessionQueryListOptions {
	agentId?: string;
	limit?: number;
	tag: SessionTag;
}

interface SessionQueryResolveOptions {
	agentId?: string;
	selector: string;
	tag: SessionTag;
}

interface SessionQuerySearchOptions {
	agentId?: string;
	limit?: number;
	query: string;
	tag: SessionTag;
}

export interface SessionSearchTurn {
	bodyText: string;
	role: "user" | "assistant";
	timestamp: number;
}

export interface SessionSearchMatch {
	session: SessionRow;
	turns: SessionSearchTurn[];
}

export type SessionResolveResult =
	| { status: "none" }
	| { status: "one"; match: SessionRow }
	| { status: "many"; matches: SessionRow[] };

export class SessionQuery {
	private readonly db: Database;

	constructor(path: string) {
		this.db = new Database(path, { readwrite: true, create: false });
		ensureSessionStoreSchema(this.db);
	}

	close() {
		this.db.close();
	}

	list(options: SessionQueryListOptions): SessionRow[] {
		const conditions = ["tag = $tag"];
		const params: Record<string, string | number> = {
			$limit: options.limit ?? 20,
			$tag: options.tag,
		};

		if (options.agentId) {
			conditions.push("agent_id = $agentId");
			params.$agentId = options.agentId;
		}

		return mapSessionRows(
			this.db
				.query(
					`SELECT
						agent_id,
						provider_id,
						sdk_session_id,
						title,
						model,
						source,
						tag,
						created_at,
						last_active
					FROM sessions
					WHERE ${conditions.join(" AND ")}
					ORDER BY last_active DESC
					LIMIT $limit`,
				)
				.all(params) as Parameters<typeof mapSessionRows>[0],
		);
	}

	resolve(options: SessionQueryResolveOptions): SessionResolveResult {
		const exactMatches = this.findByCondition(
			"sdk_session_id = $selector",
			options,
		);
		if (exactMatches.length === 1) {
			return { status: "one", match: exactMatches[0] as SessionRow };
		}
		if (exactMatches.length > 1) {
			return { status: "many", matches: exactMatches };
		}

		const prefixMatches = this.findByCondition(
			"sdk_session_id LIKE $selector",
			{
				...options,
				selector: `${options.selector}%`,
			},
		);
		if (prefixMatches.length === 0) {
			return { status: "none" };
		}
		if (prefixMatches.length === 1) {
			return { status: "one", match: prefixMatches[0] as SessionRow };
		}
		return { status: "many", matches: prefixMatches };
	}

	search(options: SessionQuerySearchOptions): SessionSearchMatch[] {
		const normalizedQuery = normalizeSearchQuery(options.query);
		const conditions = ["s.tag = $tag"];
		const params: Record<string, string | number> = {
			$query: normalizedQuery,
			$tag: options.tag,
		};
		const limitClause =
			options.limit === undefined ? "" : "\n\t\t\t\t\tLIMIT $limit";

		if (options.agentId) {
			conditions.push("s.agent_id = $agentId");
			params.$agentId = options.agentId;
		}
		if (options.limit !== undefined) {
			params.$limit = options.limit;
		}

		const rows = this.db
			.query(
				`WITH matching_sessions AS (
					SELECT
						s.agent_id,
						s.provider_id,
						s.sdk_session_id,
						s.title,
						s.model,
						s.source,
						s.tag,
						s.created_at,
						s.last_active
					FROM sessions s
					WHERE ${conditions.join(" AND ")}
					  AND EXISTS (
						SELECT 1
						FROM transcript_turns t
						JOIN transcript_turns_fts
						  ON transcript_turns_fts.rowid = t.rowid
						WHERE t.agent_id = s.agent_id
						  AND t.provider_id = s.provider_id
						  AND t.sdk_session_id = s.sdk_session_id
						  AND transcript_turns_fts MATCH $query
					  )
					ORDER BY s.last_active DESC, s.sdk_session_id ASC${limitClause}
				)
				SELECT
					ms.agent_id,
					ms.provider_id,
					ms.sdk_session_id,
					ms.title,
					ms.model,
					ms.source,
					ms.tag,
					ms.created_at,
					ms.last_active,
					t.role,
					t.body_text,
					t.timestamp,
					t.turn_index
				FROM matching_sessions ms
				JOIN transcript_turns t
				  ON t.agent_id = ms.agent_id
				 AND t.provider_id = ms.provider_id
				 AND t.sdk_session_id = ms.sdk_session_id
				JOIN transcript_turns_fts
				  ON transcript_turns_fts.rowid = t.rowid
				WHERE transcript_turns_fts MATCH $query
				ORDER BY ms.last_active DESC, ms.sdk_session_id ASC, t.timestamp ASC, t.turn_index ASC`,
			)
			.all(params) as SearchDatabaseRow[];

		const matches: SessionSearchMatch[] = [];
		let currentKey: string | undefined;
		let currentMatch: SessionSearchMatch | undefined;

		for (const row of rows) {
			const key = `${row.agent_id}\u0000${row.provider_id}\u0000${row.sdk_session_id}`;
			if (key !== currentKey) {
				currentKey = key;
				currentMatch = {
					session: {
						agentId: row.agent_id,
						providerId: row.provider_id,
						sdkSessionId: row.sdk_session_id,
						title: row.title,
						model: row.model,
						source: row.source,
						tag: row.tag,
						createdAt: row.created_at,
						lastActive: row.last_active,
					},
					turns: [],
				};
				matches.push(currentMatch);
			}

			currentMatch?.turns.push({
				bodyText: row.body_text,
				role: row.role,
				timestamp: row.timestamp,
			});
		}

		return matches;
	}

	private findByCondition(
		selectorCondition: string,
		options: SessionQueryResolveOptions,
	): SessionRow[] {
		const conditions = ["tag = $tag", selectorCondition];
		const params: Record<string, string> = {
			$selector: options.selector,
			$tag: options.tag,
		};

		if (options.agentId) {
			conditions.push("agent_id = $agentId");
			params.$agentId = options.agentId;
		}

		return mapSessionRows(
			this.db
				.query(
					`SELECT
						agent_id,
						provider_id,
						sdk_session_id,
						title,
						model,
						source,
						tag,
						created_at,
						last_active
					FROM sessions
					WHERE ${conditions.join(" AND ")}
					ORDER BY last_active DESC`,
				)
				.all(params) as Parameters<typeof mapSessionRows>[0],
		);
	}
}

interface SearchDatabaseRow {
	agent_id: string;
	body_text: string;
	created_at: number;
	last_active: number;
	model: string;
	provider_id: string;
	role: "user" | "assistant";
	sdk_session_id: string;
	source: string;
	tag: SessionTag;
	timestamp: number;
	title: string;
	turn_index: number;
}

function normalizeSearchQuery(query: string): string {
	const tokens = query
		.trim()
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token !== "");

	if (tokens.length === 0) {
		throw new Error("Search query cannot be empty");
	}

	return tokens.map(quoteFtsToken).join(" AND ");
}

function quoteFtsToken(token: string): string {
	return `"${token.replaceAll('"', '""')}"`;
}
