import type { Database } from "bun:sqlite";
import type { SessionCursor } from "../../common/protocol.ts";
import type { SessionTag } from "../persistence/session-store/session-store.ts";
import { ensureSessionStoreSchema } from "../persistence/session-store/session-store-schema.ts";
import {
	closeSqliteDatabase,
	openSqliteDatabase,
	type SqliteJournalMode,
} from "../persistence/session-store/sqlite-file-lifecycle.ts";
import {
	normalizeTitleSearchTokens,
	titleMatchesSearchTokens,
} from "../persistence/title-search.ts";
import { ensureCodingRepositoryStoreSchema } from "./coding-repository-store.ts";

export type CodingSessionLifecycleStatus = "open" | "archived";
export type CodingSessionRunStatus = "idle" | "running" | "failed";

export const CODING_STORAGE_OWNER_ID = "__coding__";

export interface CodingSessionRecord {
	storageOwnerId: string;
	providerId: string;
	sdkSessionId: string;
	repositoryId?: string;
	cwd: string;
	linkedChatSessionId?: string;
	browserTabId?: string;
	lifecycleStatus: CodingSessionLifecycleStatus;
	runStatus: CodingSessionRunStatus;
	createdAt: number;
	lastActive: number;
}

export interface CodingSessionDetail extends CodingSessionRecord {
	ocSessionId?: string;
	title: string;
	model: string;
	source: string;
	tag: SessionTag;
	failedAt?: number;
	failureMessage?: string;
}

export interface CodingSessionListResult {
	sessions: CodingSessionDetail[];
	nextCursor?: SessionCursor;
}

export type CodingSessionRefResolution =
	| {
			status: "resolved";
			session: CodingSessionRecord;
	  }
	| {
			status: "not_found";
	  }
	| {
			status: "ambiguous";
			matches: Array<{
				providerId: string;
				sdkSessionId: string;
			}>;
	  };

interface CodingSessionDatabaseRow {
	storage_owner_id: string;
	provider_id: string;
	sdk_session_id: string;
	repository_id: string | null;
	cwd: string;
	linked_chat_session_id: string | null;
	browser_tab_id: string | null;
	lifecycle_status: CodingSessionLifecycleStatus;
	run_status: CodingSessionRunStatus;
	created_at: number;
	last_active: number;
}

interface CodingSessionDetailDatabaseRow extends CodingSessionDatabaseRow {
	oc_session_id: string | null;
	title: string;
	model: string;
	source: string;
	tag: SessionTag;
	failed_at: number | null;
	failure_message: string | null;
}

interface CodingSessionStoreOptions {
	journalMode?: SqliteJournalMode;
	storageOwnerId?: string;
}

export class CodingSessionStore {
	private readonly db: Database;
	private readonly dbFileKey: string | undefined;
	private readonly storageOwnerId: string;

	constructor(path: string, options: CodingSessionStoreOptions = {}) {
		const sqlite = openSqliteDatabase(path, options.journalMode ?? "WAL");
		this.db = sqlite.db;
		this.dbFileKey = sqlite.fileKey;
		this.storageOwnerId = options.storageOwnerId ?? CODING_STORAGE_OWNER_ID;

		try {
			ensureSessionStoreSchema(this.db);
			ensureCodingSessionStoreSchema(this.db);
		} catch (error) {
			closeSqliteDatabase(this.db, this.dbFileKey);
			throw error;
		}
	}

	upsert(params: {
		providerId: string;
		sdkSessionId: string;
		repositoryId?: string;
		cwd: string;
		linkedChatSessionId?: string;
		browserTabId?: string;
		lifecycleStatus?: CodingSessionLifecycleStatus;
		runStatus: CodingSessionRunStatus;
		timestamp?: number;
	}) {
		const now = params.timestamp ?? Date.now();
		this.db
			.query(
				`INSERT INTO coding_sessions (
					agent_id,
					provider_id,
					sdk_session_id,
					repository_id,
					cwd,
					linked_chat_session_id,
					browser_tab_id,
					lifecycle_status,
					run_status,
					created_at,
					last_active
				)
				VALUES (
					$storageOwnerId,
					$providerId,
					$sdkSessionId,
					$repositoryId,
					$cwd,
					$linkedChatSessionId,
					$browserTabId,
					$lifecycleStatus,
					$runStatus,
					$now,
					$now
				)
				ON CONFLICT(agent_id, provider_id, sdk_session_id) DO UPDATE SET
					cwd = $cwd,
					repository_id = COALESCE($repositoryId, repository_id),
					linked_chat_session_id = $linkedChatSessionId,
					browser_tab_id = COALESCE($browserTabId, browser_tab_id),
					lifecycle_status = $lifecycleStatus,
					run_status = $runStatus,
					last_active = $now`,
			)
			.run({
				$storageOwnerId: this.storageOwnerId,
				$providerId: params.providerId,
				$sdkSessionId: params.sdkSessionId,
				$repositoryId: params.repositoryId ?? null,
				$cwd: params.cwd,
				$linkedChatSessionId: params.linkedChatSessionId ?? null,
				$browserTabId: params.browserTabId ?? null,
				$lifecycleStatus: params.lifecycleStatus ?? "open",
				$runStatus: params.runStatus,
				$now: now,
			});
	}

	markRunning(params: {
		providerId: string;
		sdkSessionId: string;
		timestamp?: number;
	}) {
		this.updateRunStatus({
			...params,
			runStatus: "running",
		});
	}

	markCompleted(params: {
		providerId: string;
		sdkSessionId: string;
		timestamp?: number;
	}) {
		this.updateRunStatus({
			...params,
			runStatus: "idle",
		});
	}

	markFailed(params: {
		providerId: string;
		sdkSessionId: string;
		message?: string;
		timestamp?: number;
	}) {
		const now = params.timestamp ?? Date.now();
		this.db.transaction(() => {
			this.updateRunStatus({
				providerId: params.providerId,
				sdkSessionId: params.sdkSessionId,
				runStatus: "failed",
				timestamp: now,
			});
			this.db
				.query(
					`UPDATE sessions
					 SET failed_at = $failedAt,
					     failure_message = $failureMessage,
					     last_active = $failedAt
					 WHERE agent_id = $agentId
					   AND provider_id = $providerId
					   AND sdk_session_id = $sdkSessionId`,
				)
				.run({
					$agentId: this.storageOwnerId,
					$providerId: params.providerId,
					$sdkSessionId: params.sdkSessionId,
					$failedAt: now,
					$failureMessage: params.message ?? null,
				});
		})();
	}

	delete(providerId: string, sdkSessionId: string) {
		this.db
			.query(
				`DELETE FROM sessions
				 WHERE agent_id = $agentId
				   AND provider_id = $providerId
				   AND sdk_session_id = $sdkSessionId`,
			)
			.run({
				$agentId: this.storageOwnerId,
				$providerId: providerId,
				$sdkSessionId: sdkSessionId,
			});
	}

	rename(providerId: string, sdkSessionId: string, title: string) {
		this.db
			.query(
				`UPDATE sessions
				 SET title = $title
				 WHERE agent_id = $agentId
				   AND provider_id = $providerId
				   AND sdk_session_id = $sdkSessionId`,
			)
			.run({
				$agentId: this.storageOwnerId,
				$providerId: providerId,
				$sdkSessionId: sdkSessionId,
				$title: title,
			});
	}

	list(
		options: {
			cursor?: SessionCursor;
			linkedChatSessionId?: string;
			limit?: number;
			providerId?: string;
			query?: string;
			repositoryId?: string;
		} = {},
	): CodingSessionListResult {
		const limit = options.limit ?? 20;
		const conditions = ["c.agent_id = $agentId"];
		const params: Record<string, string | number> = {
			$agentId: this.storageOwnerId,
			$limit: limit,
		};

		if (options.providerId) {
			conditions.push("c.provider_id = $providerId");
			params.$providerId = options.providerId;
		}
		if (options.repositoryId) {
			conditions.push("c.repository_id = $repositoryId");
			params.$repositoryId = options.repositoryId;
		}
		if (options.linkedChatSessionId) {
			conditions.push("c.linked_chat_session_id = $linkedChatSessionId");
			params.$linkedChatSessionId = options.linkedChatSessionId;
		}
		if (options.cursor) {
			conditions.push(
				`(
					c.last_active < $cursorLastActive
					OR (
						c.last_active = $cursorLastActive
						AND c.sdk_session_id > $cursorSessionId
					)
				)`,
			);
			params.$cursorLastActive = options.cursor.lastActive;
			params.$cursorSessionId = options.cursor.sdkSessionId;
		}

		const tokens = options.query
			? normalizeTitleSearchTokens(options.query)
			: [];
		const filtering = tokens.length > 0;
		const limitClause = filtering ? "" : "LIMIT $limit";

		const matched = mapCodingSessionDetailRows(
			this.db
				.query(
					`SELECT
						c.agent_id AS storage_owner_id,
						c.provider_id,
						c.sdk_session_id,
						c.repository_id,
						c.cwd,
						c.linked_chat_session_id,
						c.browser_tab_id,
						c.lifecycle_status,
						c.run_status,
						c.created_at,
						c.last_active,
						s.oc_session_id,
						s.title,
						s.model,
						s.source,
						s.tag,
						s.failed_at,
						s.failure_message
					FROM coding_sessions c
					INNER JOIN sessions s
					  ON s.agent_id = c.agent_id
					 AND s.provider_id = c.provider_id
					 AND s.sdk_session_id = c.sdk_session_id
					WHERE ${conditions.join(" AND ")}
					ORDER BY c.last_active DESC, c.sdk_session_id ASC
					${limitClause}`,
				)
				.all(params) as CodingSessionDetailDatabaseRow[],
		).filter((row) =>
			filtering ? titleMatchesSearchTokens(row.title, tokens) : true,
		);

		const sessions = filtering ? matched.slice(0, limit) : matched;
		return {
			sessions,
			nextCursor: nextCodingSessionCursor(sessions, limit),
		};
	}

	get(
		providerId: string,
		sdkSessionId: string,
	): CodingSessionRecord | undefined {
		return mapCodingSessionRow(
			this.db
				.query(
					`SELECT
						agent_id AS storage_owner_id,
						provider_id,
						sdk_session_id,
						repository_id,
						cwd,
						linked_chat_session_id,
						browser_tab_id,
						lifecycle_status,
						run_status,
						created_at,
						last_active
					FROM coding_sessions
					WHERE agent_id = $agentId
					  AND provider_id = $providerId
					  AND sdk_session_id = $sdkSessionId`,
				)
				.get({
					$agentId: this.storageOwnerId,
					$providerId: providerId,
					$sdkSessionId: sdkSessionId,
				}) as CodingSessionDatabaseRow | null,
		);
	}

	resolveRef(params: {
		providerId?: string;
		sdkSessionId: string;
	}): CodingSessionRefResolution {
		if (params.providerId) {
			const session = this.get(params.providerId, params.sdkSessionId);
			return session
				? { status: "resolved", session }
				: { status: "not_found" };
		}

		const rows = this.db
			.query(
				`SELECT
					agent_id AS storage_owner_id,
					provider_id,
					sdk_session_id,
					repository_id,
					cwd,
					linked_chat_session_id,
					browser_tab_id,
					lifecycle_status,
					run_status,
					created_at,
					last_active
				FROM coding_sessions
				WHERE agent_id = $agentId
				  AND sdk_session_id = $sdkSessionId
				ORDER BY provider_id ASC
				LIMIT 2`,
			)
			.all({
				$agentId: this.storageOwnerId,
				$sdkSessionId: params.sdkSessionId,
			}) as CodingSessionDatabaseRow[];

		if (rows.length === 0) {
			return { status: "not_found" };
		}
		if (rows.length > 1) {
			return {
				status: "ambiguous",
				matches: rows.map((row) => ({
					providerId: row.provider_id,
					sdkSessionId: row.sdk_session_id,
				})),
			};
		}

		const session = mapCodingSessionRow(rows[0]);
		return session ? { status: "resolved", session } : { status: "not_found" };
	}

	getDetail(
		providerId: string,
		sdkSessionId: string,
	): CodingSessionDetail | undefined {
		return mapCodingSessionDetailRow(
			this.db
				.query(
					`SELECT
						c.agent_id AS storage_owner_id,
						c.provider_id,
						c.sdk_session_id,
						c.repository_id,
						c.cwd,
						c.linked_chat_session_id,
						c.browser_tab_id,
						c.lifecycle_status,
						c.run_status,
						c.created_at,
						c.last_active,
						s.oc_session_id,
						s.title,
						s.model,
						s.source,
						s.tag,
						s.failed_at,
						s.failure_message
					FROM coding_sessions c
					INNER JOIN sessions s
					  ON s.agent_id = c.agent_id
					 AND s.provider_id = c.provider_id
					 AND s.sdk_session_id = c.sdk_session_id
					WHERE c.agent_id = $agentId
					  AND c.provider_id = $providerId
					  AND c.sdk_session_id = $sdkSessionId`,
				)
				.get({
					$agentId: this.storageOwnerId,
					$providerId: providerId,
					$sdkSessionId: sdkSessionId,
				}) as CodingSessionDetailDatabaseRow | null,
		);
	}

	close() {
		closeSqliteDatabase(this.db, this.dbFileKey);
	}

	private updateRunStatus(params: {
		providerId: string;
		sdkSessionId: string;
		runStatus: CodingSessionRunStatus;
		timestamp?: number;
	}) {
		const now = params.timestamp ?? Date.now();
		this.db
			.query(
				`UPDATE coding_sessions
				 SET run_status = $runStatus,
				     last_active = $now
				 WHERE agent_id = $agentId
				   AND provider_id = $providerId
				   AND sdk_session_id = $sdkSessionId`,
			)
			.run({
				$agentId: this.storageOwnerId,
				$providerId: params.providerId,
				$sdkSessionId: params.sdkSessionId,
				$runStatus: params.runStatus,
				$now: now,
			});
	}
}

export function ensureCodingSessionStoreSchema(db: Database) {
	ensureCodingRepositoryStoreSchema(db);
	db.exec(`CREATE TABLE IF NOT EXISTS coding_sessions (
		agent_id TEXT NOT NULL,
		provider_id TEXT NOT NULL,
		sdk_session_id TEXT NOT NULL,
		repository_id TEXT,
		cwd TEXT NOT NULL,
		linked_chat_session_id TEXT,
		browser_tab_id TEXT,
		lifecycle_status TEXT NOT NULL,
		run_status TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		last_active INTEGER NOT NULL,
		PRIMARY KEY (agent_id, provider_id, sdk_session_id),
		FOREIGN KEY (repository_id)
			REFERENCES coding_repositories(id)
			ON DELETE SET NULL,
		FOREIGN KEY (agent_id, provider_id, sdk_session_id)
			REFERENCES sessions(agent_id, provider_id, sdk_session_id)
			ON DELETE CASCADE
	)`);
}

function mapCodingSessionRow(
	row: CodingSessionDatabaseRow | null | undefined,
): CodingSessionRecord | undefined {
	if (!row) {
		return undefined;
	}

	return {
		storageOwnerId: row.storage_owner_id,
		providerId: row.provider_id,
		sdkSessionId: row.sdk_session_id,
		...(row.repository_id ? { repositoryId: row.repository_id } : {}),
		cwd: row.cwd,
		...(row.linked_chat_session_id
			? { linkedChatSessionId: row.linked_chat_session_id }
			: {}),
		...(row.browser_tab_id ? { browserTabId: row.browser_tab_id } : {}),
		lifecycleStatus: row.lifecycle_status,
		runStatus: row.run_status,
		createdAt: row.created_at,
		lastActive: row.last_active,
	};
}

function mapCodingSessionDetailRows(
	rows: CodingSessionDetailDatabaseRow[],
): CodingSessionDetail[] {
	return rows.map((row) => mapCodingSessionDetailRow(row)).filter(isPresent);
}

function mapCodingSessionDetailRow(
	row: CodingSessionDetailDatabaseRow | null | undefined,
): CodingSessionDetail | undefined {
	const codingSession = mapCodingSessionRow(row);
	if (!codingSession || !row) {
		return undefined;
	}

	return {
		...codingSession,
		...(row.oc_session_id ? { ocSessionId: row.oc_session_id } : {}),
		title: row.title,
		model: row.model,
		source: row.source,
		tag: row.tag,
		...(row.failed_at !== null ? { failedAt: row.failed_at } : {}),
		...(row.failure_message ? { failureMessage: row.failure_message } : {}),
	};
}

function nextCodingSessionCursor(
	sessions: CodingSessionDetail[],
	limit: number,
): SessionCursor | undefined {
	if (sessions.length !== limit || sessions.length === 0) {
		return undefined;
	}

	const lastSession = sessions[sessions.length - 1];
	if (!lastSession) {
		return undefined;
	}

	return {
		lastActive: lastSession.lastActive,
		sdkSessionId: lastSession.sdkSessionId,
	};
}

function isPresent<T>(value: T | undefined): value is T {
	return value !== undefined;
}
