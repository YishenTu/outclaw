import type { Database } from "bun:sqlite";
import type { SessionTag } from "../persistence/session-store/session-store.ts";
import { ensureSessionStoreSchema } from "../persistence/session-store/session-store-schema.ts";
import {
	closeSqliteDatabase,
	openSqliteDatabase,
	type SqliteJournalMode,
} from "../persistence/session-store/sqlite-file-lifecycle.ts";
import {
	CODING_STORAGE_OWNER_ID,
	type CodingSessionDetail,
	type CodingSessionLifecycleStatus,
	type CodingSessionRunStatus,
	ensureCodingSessionStoreSchema,
} from "./coding-session-store.ts";

interface ChatCodingLinkStoreOptions {
	journalMode?: SqliteJournalMode;
	codingStorageOwnerId?: string;
}

interface CodingSessionDetailDatabaseRow {
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
	oc_session_id: string | null;
	title: string;
	model: string;
	source: string;
	tag: SessionTag;
	failed_at: number | null;
	failure_message: string | null;
}

export class ChatCodingLinkStore {
	private readonly db: Database;
	private readonly dbFileKey: string | undefined;
	private readonly codingStorageOwnerId: string;

	constructor(path: string, options: ChatCodingLinkStoreOptions = {}) {
		const sqlite = openSqliteDatabase(path, options.journalMode ?? "WAL");
		this.db = sqlite.db;
		this.dbFileKey = sqlite.fileKey;
		this.codingStorageOwnerId =
			options.codingStorageOwnerId ?? CODING_STORAGE_OWNER_ID;

		try {
			ensureSessionStoreSchema(this.db);
			ensureCodingSessionStoreSchema(this.db);
			ensureChatCodingLinkStoreSchema(this.db);
		} catch (error) {
			closeSqliteDatabase(this.db, this.dbFileKey);
			throw error;
		}
	}

	upsert(params: {
		chatAgentId: string;
		chatProviderId: string;
		chatSdkSessionId: string;
		codingProviderId: string;
		codingSdkSessionId: string;
		timestamp?: number;
	}) {
		const now = params.timestamp ?? Date.now();
		this.db.transaction(() => {
			const targetExists = this.db
				.query(
					`SELECT 1
					 FROM sessions chat
					 INNER JOIN coding_sessions coding
					   ON coding.agent_id = $codingStorageOwnerId
					  AND coding.provider_id = $codingProviderId
					  AND coding.sdk_session_id = $codingSdkSessionId
					 WHERE chat.agent_id = $chatAgentId
					   AND chat.provider_id = $chatProviderId
					   AND chat.sdk_session_id = $chatSdkSessionId
					 LIMIT 1`,
				)
				.get({
					$chatAgentId: params.chatAgentId,
					$chatProviderId: params.chatProviderId,
					$chatSdkSessionId: params.chatSdkSessionId,
					$codingStorageOwnerId: this.codingStorageOwnerId,
					$codingProviderId: params.codingProviderId,
					$codingSdkSessionId: params.codingSdkSessionId,
				});
			if (!targetExists) {
				return;
			}
			this.db
				.query(
					`INSERT INTO chat_coding_links (
						chat_agent_id,
						chat_provider_id,
						chat_sdk_session_id,
						coding_storage_owner_id,
						coding_provider_id,
						coding_sdk_session_id,
						first_linked_at,
						last_linked_at
					)
					VALUES (
						$chatAgentId,
						$chatProviderId,
						$chatSdkSessionId,
						$codingStorageOwnerId,
						$codingProviderId,
						$codingSdkSessionId,
						$now,
						$now
					)
					ON CONFLICT (
						chat_agent_id,
						chat_provider_id,
						chat_sdk_session_id,
						coding_storage_owner_id,
						coding_provider_id,
						coding_sdk_session_id
					)
					DO UPDATE SET last_linked_at = $now`,
				)
				.run({
					$chatAgentId: params.chatAgentId,
					$chatProviderId: params.chatProviderId,
					$chatSdkSessionId: params.chatSdkSessionId,
					$codingStorageOwnerId: this.codingStorageOwnerId,
					$codingProviderId: params.codingProviderId,
					$codingSdkSessionId: params.codingSdkSessionId,
					$now: now,
				});
		})();
	}

	listForChat(params: {
		chatAgentId: string;
		chatProviderId: string;
		chatSdkSessionId: string;
		limit?: number;
	}): CodingSessionDetail[] {
		const limitClause = params.limit === undefined ? "" : "LIMIT $limit";
		const queryParams: Record<string, string | number> = {
			$chatAgentId: params.chatAgentId,
			$chatProviderId: params.chatProviderId,
			$chatSdkSessionId: params.chatSdkSessionId,
			$codingStorageOwnerId: this.codingStorageOwnerId,
		};
		if (params.limit !== undefined) {
			queryParams.$limit = params.limit;
		}
		return mapCodingSessionDetailRows(
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
					FROM chat_coding_links l
					INNER JOIN coding_sessions c
					  ON c.agent_id = l.coding_storage_owner_id
					 AND c.provider_id = l.coding_provider_id
					 AND c.sdk_session_id = l.coding_sdk_session_id
					INNER JOIN sessions s
					  ON s.agent_id = c.agent_id
					 AND s.provider_id = c.provider_id
					 AND s.sdk_session_id = c.sdk_session_id
					WHERE l.chat_agent_id = $chatAgentId
					  AND l.chat_provider_id = $chatProviderId
					  AND l.chat_sdk_session_id = $chatSdkSessionId
					  AND l.coding_storage_owner_id = $codingStorageOwnerId
					ORDER BY l.last_linked_at DESC, l.coding_sdk_session_id ASC
					${limitClause}`,
				)
				.all(queryParams) as CodingSessionDetailDatabaseRow[],
		);
	}

	close() {
		closeSqliteDatabase(this.db, this.dbFileKey);
	}
}

export function ensureChatCodingLinkStoreSchema(db: Database) {
	db.exec(`CREATE TABLE IF NOT EXISTS chat_coding_links (
		chat_agent_id TEXT NOT NULL,
		chat_provider_id TEXT NOT NULL,
		chat_sdk_session_id TEXT NOT NULL,
		coding_storage_owner_id TEXT NOT NULL,
		coding_provider_id TEXT NOT NULL,
		coding_sdk_session_id TEXT NOT NULL,
		first_linked_at INTEGER NOT NULL,
		last_linked_at INTEGER NOT NULL,
		PRIMARY KEY (
			chat_agent_id,
			chat_provider_id,
			chat_sdk_session_id,
			coding_storage_owner_id,
			coding_provider_id,
			coding_sdk_session_id
		),
		FOREIGN KEY (chat_agent_id, chat_provider_id, chat_sdk_session_id)
			REFERENCES sessions(agent_id, provider_id, sdk_session_id)
			ON DELETE CASCADE,
		FOREIGN KEY (
			coding_storage_owner_id,
			coding_provider_id,
			coding_sdk_session_id
		)
			REFERENCES coding_sessions(agent_id, provider_id, sdk_session_id)
			ON DELETE CASCADE
	)`);
}

function mapCodingSessionDetailRows(
	rows: CodingSessionDetailDatabaseRow[],
): CodingSessionDetail[] {
	return rows.map((row) => ({
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
		...(row.oc_session_id ? { ocSessionId: row.oc_session_id } : {}),
		title: row.title,
		model: row.model,
		source: row.source,
		tag: row.tag,
		...(row.failed_at ? { failedAt: row.failed_at } : {}),
		...(row.failure_message ? { failureMessage: row.failure_message } : {}),
	}));
}
