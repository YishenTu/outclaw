import type { Database } from "bun:sqlite";
import type { SessionCursor } from "../../common/protocol.ts";
import type { SessionTag } from "../persistence/session-store/session-store.ts";
import type { TableColumnInfo } from "../persistence/session-store/session-store-records.ts";
import { ensureSessionStoreSchema } from "../persistence/session-store/session-store-schema.ts";
import {
	closeSqliteDatabase,
	openSqliteDatabase,
	type SqliteJournalMode,
} from "../persistence/session-store/sqlite-file-lifecycle.ts";
import { ensureCodingRepositoryStoreSchema } from "./coding-repository-store.ts";

export type CodingSessionStatus = "running" | "completed" | "failed";

export interface LinkedChatSession {
	agentId: string;
	providerId: string;
	sessionId: string;
}

export interface CodingSessionRecord {
	agentId: string;
	providerId: string;
	sdkSessionId: string;
	repositoryId?: string;
	cwd: string;
	linkedChat?: LinkedChatSession;
	browserTabId?: string;
	status: CodingSessionStatus;
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

interface CodingSessionDatabaseRow {
	agent_id: string;
	provider_id: string;
	sdk_session_id: string;
	repository_id: string | null;
	cwd: string;
	linked_chat_agent_id: string | null;
	linked_chat_provider_id: string | null;
	linked_chat_session_id: string | null;
	browser_tab_id: string | null;
	status: CodingSessionStatus;
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
	agentId?: string;
	journalMode?: SqliteJournalMode;
}

const DEFAULT_AGENT_ID = "agent-default";

export class CodingSessionStore {
	private readonly db: Database;
	private readonly dbFileKey: string | undefined;
	private readonly agentId: string;

	constructor(path: string, options: CodingSessionStoreOptions = {}) {
		const sqlite = openSqliteDatabase(path, options.journalMode ?? "WAL");
		this.db = sqlite.db;
		this.dbFileKey = sqlite.fileKey;
		this.agentId = options.agentId ?? DEFAULT_AGENT_ID;

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
		linkedChat?: LinkedChatSession;
		browserTabId?: string;
		status: CodingSessionStatus;
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
					linked_chat_agent_id,
					linked_chat_provider_id,
					linked_chat_session_id,
					browser_tab_id,
					status,
					created_at,
					last_active
				)
				VALUES (
					$agentId,
					$providerId,
					$sdkSessionId,
					$repositoryId,
					$cwd,
					$linkedChatAgentId,
					$linkedChatProviderId,
					$linkedChatSessionId,
					$browserTabId,
					$status,
					$now,
					$now
				)
				ON CONFLICT(agent_id, provider_id, sdk_session_id) DO UPDATE SET
					cwd = $cwd,
					repository_id = COALESCE($repositoryId, repository_id),
					linked_chat_agent_id = $linkedChatAgentId,
					linked_chat_provider_id = $linkedChatProviderId,
					linked_chat_session_id = $linkedChatSessionId,
					browser_tab_id = COALESCE($browserTabId, browser_tab_id),
					status = $status,
					last_active = $now`,
			)
			.run({
				$agentId: this.agentId,
				$providerId: params.providerId,
				$sdkSessionId: params.sdkSessionId,
				$repositoryId: params.repositoryId ?? null,
				$cwd: params.cwd,
				$linkedChatAgentId: params.linkedChat?.agentId ?? null,
				$linkedChatProviderId: params.linkedChat?.providerId ?? null,
				$linkedChatSessionId: params.linkedChat?.sessionId ?? null,
				$browserTabId: params.browserTabId ?? null,
				$status: params.status,
				$now: now,
			});
	}

	markRunning(params: {
		providerId: string;
		sdkSessionId: string;
		timestamp?: number;
	}) {
		this.updateStatus({
			...params,
			status: "running",
		});
	}

	markCompleted(params: {
		providerId: string;
		sdkSessionId: string;
		timestamp?: number;
	}) {
		this.updateStatus({
			...params,
			status: "completed",
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
			this.updateStatus({
				providerId: params.providerId,
				sdkSessionId: params.sdkSessionId,
				status: "failed",
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
					$agentId: this.agentId,
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
				$agentId: this.agentId,
				$providerId: providerId,
				$sdkSessionId: sdkSessionId,
			});
	}

	list(
		options: {
			cursor?: SessionCursor;
			linkedChat?: LinkedChatSession;
			limit?: number;
			providerId?: string;
			repositoryId?: string;
		} = {},
	): CodingSessionListResult {
		const limit = options.limit ?? 20;
		const conditions = ["c.agent_id = $agentId"];
		const params: Record<string, string | number> = {
			$agentId: this.agentId,
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
		if (options.linkedChat) {
			conditions.push("c.linked_chat_agent_id = $linkedChatAgentId");
			conditions.push("c.linked_chat_provider_id = $linkedChatProviderId");
			conditions.push("c.linked_chat_session_id = $linkedChatSessionId");
			params.$linkedChatAgentId = options.linkedChat.agentId;
			params.$linkedChatProviderId = options.linkedChat.providerId;
			params.$linkedChatSessionId = options.linkedChat.sessionId;
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

		const sessions = mapCodingSessionDetailRows(
			this.db
				.query(
					`SELECT
						c.agent_id,
						c.provider_id,
						c.sdk_session_id,
						c.repository_id,
						c.cwd,
						c.linked_chat_agent_id,
						c.linked_chat_provider_id,
						c.linked_chat_session_id,
						c.browser_tab_id,
						c.status,
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
					LIMIT $limit`,
				)
				.all(params) as CodingSessionDetailDatabaseRow[],
		);

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
						agent_id,
						provider_id,
						sdk_session_id,
						repository_id,
						cwd,
						linked_chat_agent_id,
						linked_chat_provider_id,
						linked_chat_session_id,
						browser_tab_id,
						status,
						created_at,
						last_active
					FROM coding_sessions
					WHERE agent_id = $agentId
					  AND provider_id = $providerId
					  AND sdk_session_id = $sdkSessionId`,
				)
				.get({
					$agentId: this.agentId,
					$providerId: providerId,
					$sdkSessionId: sdkSessionId,
				}) as CodingSessionDatabaseRow | null,
		);
	}

	getDetail(
		providerId: string,
		sdkSessionId: string,
	): CodingSessionDetail | undefined {
		return mapCodingSessionDetailRow(
			this.db
				.query(
					`SELECT
						c.agent_id,
						c.provider_id,
						c.sdk_session_id,
						c.repository_id,
						c.cwd,
						c.linked_chat_agent_id,
						c.linked_chat_provider_id,
						c.linked_chat_session_id,
						c.browser_tab_id,
						c.status,
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
					$agentId: this.agentId,
					$providerId: providerId,
					$sdkSessionId: sdkSessionId,
				}) as CodingSessionDetailDatabaseRow | null,
		);
	}

	close() {
		closeSqliteDatabase(this.db, this.dbFileKey);
	}

	private updateStatus(params: {
		providerId: string;
		sdkSessionId: string;
		status: CodingSessionStatus;
		timestamp?: number;
	}) {
		const now = params.timestamp ?? Date.now();
		this.db
			.query(
				`UPDATE coding_sessions
				 SET status = $status,
				     last_active = $now
				 WHERE agent_id = $agentId
				   AND provider_id = $providerId
				   AND sdk_session_id = $sdkSessionId`,
			)
			.run({
				$agentId: this.agentId,
				$providerId: params.providerId,
				$sdkSessionId: params.sdkSessionId,
				$status: params.status,
				$now: now,
			});
	}
}

function ensureCodingSessionStoreSchema(db: Database) {
	ensureCodingRepositoryStoreSchema(db);
	db.exec(`CREATE TABLE IF NOT EXISTS coding_sessions (
		agent_id TEXT NOT NULL,
		provider_id TEXT NOT NULL,
		sdk_session_id TEXT NOT NULL,
		repository_id TEXT,
		cwd TEXT NOT NULL,
		linked_chat_agent_id TEXT,
		linked_chat_provider_id TEXT,
		linked_chat_session_id TEXT,
		browser_tab_id TEXT,
		status TEXT NOT NULL,
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
	const columns = db
		.query("PRAGMA table_info(coding_sessions)")
		.all() as TableColumnInfo[];
	if (!columns.some((column) => column.name === "repository_id")) {
		db.exec("ALTER TABLE coding_sessions ADD COLUMN repository_id TEXT");
	}
}

function mapCodingSessionRow(
	row: CodingSessionDatabaseRow | null | undefined,
): CodingSessionRecord | undefined {
	if (!row) {
		return undefined;
	}

	const linkedChat =
		row.linked_chat_agent_id &&
		row.linked_chat_provider_id &&
		row.linked_chat_session_id
			? {
					agentId: row.linked_chat_agent_id,
					providerId: row.linked_chat_provider_id,
					sessionId: row.linked_chat_session_id,
				}
			: undefined;

	return {
		agentId: row.agent_id,
		providerId: row.provider_id,
		sdkSessionId: row.sdk_session_id,
		repositoryId: row.repository_id ?? undefined,
		cwd: row.cwd,
		linkedChat,
		browserTabId: row.browser_tab_id ?? undefined,
		status: row.status,
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
		ocSessionId: row.oc_session_id ?? undefined,
		title: row.title,
		model: row.model,
		source: row.source,
		tag: row.tag,
		failedAt: row.failed_at ?? undefined,
		failureMessage: row.failure_message ?? undefined,
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
