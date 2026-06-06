import { Database } from "bun:sqlite";
import type { SessionCursor } from "../../common/protocol.ts";
import { addSessionCursorCondition } from "./session-cursor.ts";
import {
	mapSessionRows,
	type SessionDatabaseRow,
	type SessionRow,
	type SessionTag,
} from "./session-store/session-store-records.ts";
import { ensureSessionStoreSchema } from "./session-store/session-store-schema.ts";
import {
	normalizeTitleSearchTokens,
	titleMatchesSearchTokens,
} from "./title-search.ts";

interface SessionQueryListOptions {
	agentId?: string;
	cursor?: SessionCursor;
	limit?: number;
	providerId?: string;
	tag: SessionTag;
}

interface SessionQueryResolveOptions {
	agentId?: string;
	selector: string;
	tag: SessionTag;
}

interface SessionQuerySearchOptions {
	agentId?: string;
	cursor?: SessionCursor;
	limit?: number;
	query: string;
	tag: SessionTag;
}

interface SessionQuerySearchByTitleOptions {
	agentId?: string;
	cursor?: SessionCursor;
	limit?: number;
	providerId?: string;
	query: string;
	tag: SessionTag;
}

interface FailedCronRunListOptions {
	agentId?: string;
	jobName?: string;
	limit?: number;
	since?: number;
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
		if (options.providerId) {
			conditions.push("provider_id = $providerId");
			params.$providerId = options.providerId;
		}
		addSessionCursorCondition(conditions, params, options.cursor);

		return mapSessionRows(
			this.db
				.query(
					`SELECT
						agent_id,
						provider_id,
						sdk_session_id,
						title,
						model,
						service_tier,
						source,
						tag,
						created_at,
						last_active
					FROM sessions
					WHERE ${conditions.join(" AND ")}
					ORDER BY last_active DESC, sdk_session_id ASC
					LIMIT $limit`,
				)
				.all(params) as Parameters<typeof mapSessionRows>[0],
		);
	}

	searchByTitle(options: SessionQuerySearchByTitleOptions): SessionRow[] {
		const tokens = normalizeTitleSearchTokens(options.query);
		if (tokens.length === 0) {
			return [];
		}

		const conditions = ["tag = $tag"];
		const params: Record<string, string | number> = {
			$tag: options.tag,
		};

		if (options.agentId) {
			conditions.push("agent_id = $agentId");
			params.$agentId = options.agentId;
		}
		if (options.providerId) {
			conditions.push("provider_id = $providerId");
			params.$providerId = options.providerId;
		}
		addSessionCursorCondition(conditions, params, options.cursor);

		const matches = mapSessionRows(
			this.db
				.query(
					`SELECT
						agent_id,
						provider_id,
						sdk_session_id,
						title,
						model,
						service_tier,
						source,
						tag,
						created_at,
						last_active
						FROM sessions
						WHERE ${conditions.join(" AND ")}
						ORDER BY last_active DESC, sdk_session_id ASC`,
				)
				.all(params) as Parameters<typeof mapSessionRows>[0],
		).filter((row) => titleMatchesSearchTokens(row.title, tokens));

		return options.limit === undefined
			? matches
			: matches.slice(0, options.limit);
	}

	listFailedCronRuns(options: FailedCronRunListOptions): SessionRow[] {
		const conditions = ["tag = 'cron'", "failed_at IS NOT NULL"];
		const params: Record<string, string | number> = {};

		if (options.agentId) {
			conditions.push("agent_id = $agentId");
			params.$agentId = options.agentId;
		}
		if (options.jobName) {
			conditions.push("title = $jobName");
			params.$jobName = options.jobName;
		}
		if (options.since !== undefined) {
			conditions.push("failed_at >= $since");
			params.$since = options.since;
		}

		const limitClause =
			options.limit === undefined ? "" : "\n\t\t\t\t\t\tLIMIT $limit";
		if (options.limit !== undefined) {
			params.$limit = options.limit;
		}

		return mapSessionRows(
			this.db
				.query(
					`SELECT
						agent_id,
						provider_id,
						sdk_session_id,
						oc_session_id,
						title,
						model,
						service_tier,
						source,
						tag,
						created_at,
						last_active,
						failed_at,
						failure_message
					FROM sessions
					WHERE ${conditions.join(" AND ")}
					ORDER BY failed_at DESC, sdk_session_id DESC${limitClause}`,
				)
				.all(params) as SessionDatabaseRow[],
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
		if (options.cursor) {
			conditions.push(
				`(
					s.last_active < $cursorLastActive
					OR (
						s.last_active = $cursorLastActive
						AND s.sdk_session_id > $cursorSessionId
					)
				)`,
			);
			params.$cursorLastActive = options.cursor.lastActive;
			params.$cursorSessionId = options.cursor.sdkSessionId;
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
						s.service_tier,
						s.source,
						s.tag,
						s.created_at,
						s.last_active,
						s.auto_title_attempted
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
					ms.service_tier,
					ms.source,
					ms.tag,
					ms.created_at,
					ms.last_active,
					ms.auto_title_attempted,
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
						serviceTier: row.service_tier ?? undefined,
						source: row.source,
						tag: row.tag,
						createdAt: row.created_at,
						lastActive: row.last_active,
						autoTitleAttempted: row.auto_title_attempted === 1,
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
						service_tier,
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
	auto_title_attempted?: number | null;
	model: string;
	provider_id: string;
	role: "user" | "assistant";
	sdk_session_id: string;
	service_tier?: string | null;
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
