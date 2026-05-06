import type { Database } from "bun:sqlite";
import type {
	BrowserCronHistoryCursor,
	FrontendNotice,
	TranscriptTurn,
	UsageInfo,
} from "../../../common/protocol.ts";
import type { LastUserTarget } from "../last-user-target.ts";
import { SessionStateStore } from "./session-state-store.ts";
import {
	mapSessionRow,
	mapSessionRows,
	type SessionRow,
	type SessionTag,
} from "./session-store-records.ts";
import { ensureSessionStoreSchema } from "./session-store-schema.ts";
import { SessionTranscriptIndex } from "./session-transcript-index.ts";
import { SessionUsageStore } from "./session-usage-store.ts";
import {
	closeSqliteDatabase,
	openSqliteDatabase,
} from "./sqlite-file-lifecycle.ts";

interface SessionStoreOptions {
	agentId?: string;
	journalMode?: "WAL" | "DELETE";
}

export type { SessionRow, SessionTag } from "./session-store-records.ts";

const DEFAULT_AGENT_ID = "agent-default";

export class SessionStore {
	private db: Database;
	private dbFileKey: string | undefined;
	private readonly agentId: string;
	private readonly dbPath: string;
	private readonly journalMode: "WAL" | "DELETE";
	private readonly stateStore: SessionStateStore;
	private readonly transcriptIndex: SessionTranscriptIndex;
	private readonly usageStore: SessionUsageStore;

	constructor(path: string, options: SessionStoreOptions = {}) {
		this.dbPath = path;
		this.journalMode = options.journalMode ?? "WAL";
		this.agentId = options.agentId ?? DEFAULT_AGENT_ID;
		const sqlite = openSqliteDatabase(path, this.journalMode);
		this.db = sqlite.db;
		this.dbFileKey = sqlite.fileKey;
		this.stateStore = new SessionStateStore(() => this.db, this.agentId);
		this.transcriptIndex = new SessionTranscriptIndex(
			() => this.db,
			this.agentId,
		);
		this.usageStore = new SessionUsageStore(() => this.db, this.agentId);
		try {
			ensureSessionStoreSchema(this.db);
			this.stateStore.migrateLegacyStateKeys();
		} catch (error) {
			closeSqliteDatabase(this.db, this.dbFileKey);
			throw error;
		}
	}

	upsert(params: {
		providerId: string;
		sdkSessionId: string;
		ocSessionId?: string;
		title: string;
		model: string;
		source?: string;
		tag?: SessionTag;
		timestamp?: number;
		failure?: {
			failedAt: number;
			message: string;
		};
	}) {
		const now = params.timestamp ?? Date.now();
		this.db
			.query(
				`INSERT INTO sessions (
						agent_id,
						provider_id,
						sdk_session_id,
						oc_session_id,
						title,
						model,
						source,
						tag,
						created_at,
						last_active,
						failed_at,
						failure_message
					)
					VALUES (
						$agentId,
						$providerId,
						$id,
						$ocSessionId,
						$title,
						$model,
						$source,
						$tag,
						$now,
						$now,
						$failedAt,
						$failureMessage
					)
					ON CONFLICT(agent_id, provider_id, sdk_session_id) DO UPDATE SET
						oc_session_id = COALESCE($ocSessionId, oc_session_id),
						title = $title,
						model = $model,
						source = $source,
						tag = $tag,
						last_active = $now,
						failed_at = COALESCE($failedAt, failed_at),
						failure_message = COALESCE($failureMessage, failure_message)`,
			)
			.run({
				$agentId: this.agentId,
				$providerId: params.providerId,
				$id: params.sdkSessionId,
				$ocSessionId: params.ocSessionId ?? null,
				$title: params.title,
				$model: params.model,
				$source: params.source ?? "tui",
				$tag: params.tag ?? "chat",
				$now: now,
				$failedAt: params.failure?.failedAt ?? null,
				$failureMessage: params.failure?.message ?? null,
			});
	}

	get(providerId: string, sdkSessionId: string): SessionRow | undefined {
		return mapSessionRow(
			this.db
				.query(
					`SELECT
						agent_id,
						provider_id,
						sdk_session_id,
						oc_session_id,
						title,
						model,
								source,
								tag,
								created_at,
								last_active,
								failed_at,
								failure_message,
								auto_title_attempted
					FROM sessions
					WHERE agent_id = $agentId
					  AND provider_id = $providerId
					  AND sdk_session_id = $id`,
				)
				.get({
					$agentId: this.agentId,
					$providerId: providerId,
					$id: sdkSessionId,
				}) as Parameters<typeof mapSessionRow>[0],
		);
	}

	findByPrefix(
		providerId: string,
		prefix: string,
		tag?: SessionTag,
	): SessionRow | undefined {
		const exactMatch = this.get(providerId, prefix);
		if (exactMatch && (!tag || exactMatch.tag === tag)) {
			return exactMatch;
		}

		const exactAliasMatch = mapSessionRow(
			this.db
				.query(
					`SELECT
						agent_id,
						provider_id,
						sdk_session_id,
						oc_session_id,
						title,
						model,
							source,
							tag,
							created_at,
							last_active,
							failed_at,
							failure_message,
							auto_title_attempted
					FROM sessions
					WHERE agent_id = $agentId
					  AND provider_id = $providerId
					  AND oc_session_id = $id`,
				)
				.get({
					$agentId: this.agentId,
					$providerId: providerId,
					$id: prefix,
				}) as Parameters<typeof mapSessionRow>[0],
		);
		if (exactAliasMatch && (!tag || exactAliasMatch.tag === tag)) {
			return exactAliasMatch;
		}

		const conditions = [
			"agent_id = $agentId",
			"provider_id = $providerId",
			"(sdk_session_id LIKE $prefix OR oc_session_id LIKE $prefix)",
		];
		const params: Record<string, string> = {
			$agentId: this.agentId,
			$providerId: providerId,
			$prefix: `${prefix}%`,
		};
		if (tag) {
			conditions.push("tag = $tag");
			params.$tag = tag;
		}

		return mapSessionRow(
			this.db
				.query(
					`SELECT
						agent_id,
						provider_id,
						sdk_session_id,
						oc_session_id,
						title,
						model,
							source,
							tag,
							created_at,
							last_active,
							failed_at,
							failure_message,
							auto_title_attempted
					FROM sessions
					WHERE ${conditions.join(" AND ")}
					ORDER BY last_active DESC
					LIMIT 1`,
				)
				.get(params) as Parameters<typeof mapSessionRow>[0],
		);
	}

	listCronRunsByTitle(
		title: string,
		options: { limit: number; before?: BrowserCronHistoryCursor },
	): Array<{
		providerId: string;
		sessionId: string;
		ranAt: number;
		resultText: string;
	}> {
		const conditions = [
			"s.agent_id = $agentId",
			"s.tag = 'cron'",
			"s.title = $title",
		];
		const params: Record<string, string | number> = {
			$agentId: this.agentId,
			$title: title,
			$limit: options.limit,
		};
		if (options.before) {
			conditions.push(
				`(
					s.last_active < $beforeRanAt
					OR (
						s.last_active = $beforeRanAt
						AND s.provider_id < $beforeProviderId
					)
					OR (
						s.last_active = $beforeRanAt
						AND s.provider_id = $beforeProviderId
						AND s.sdk_session_id < $beforeSessionId
					)
				)`,
			);
			params.$beforeRanAt = options.before.ranAt;
			params.$beforeProviderId = options.before.providerId;
			params.$beforeSessionId = options.before.sessionId;
		}

		return this.withRecoveredConnection(() => {
			const sessionRows = this.db
				.query(
					`SELECT
						s.sdk_session_id,
						s.provider_id,
						s.last_active
					 FROM sessions s
					 WHERE ${conditions.join(" AND ")}
					 ORDER BY s.last_active DESC, s.provider_id DESC, s.sdk_session_id DESC
					 LIMIT $limit`,
				)
				.all(params) as Array<{
				sdk_session_id: string;
				provider_id: string;
				last_active: number;
			}>;

			if (sessionRows.length === 0) {
				return [];
			}

			return sessionRows.map((row) => ({
				providerId: row.provider_id,
				sessionId: row.sdk_session_id,
				ranAt: row.last_active,
				resultText: this.readIndexedAssistantText(
					row.provider_id,
					row.sdk_session_id,
				),
			}));
		});
	}

	list(limit = 20, tag?: SessionTag, providerId?: string): SessionRow[] {
		const conditions: string[] = ["agent_id = $agentId"];
		const params: Record<string, string | number> = {
			$agentId: this.agentId,
			$limit: limit,
		};

		if (providerId) {
			conditions.push("provider_id = $providerId");
			params.$providerId = providerId;
		}
		if (tag) {
			conditions.push("tag = $tag");
			params.$tag = tag;
		}

		return this.withRecoveredConnection(() =>
			mapSessionRows(
				this.db
					.query(
						`SELECT
							agent_id,
							provider_id,
							sdk_session_id,
							oc_session_id,
							title,
							model,
							source,
							tag,
							created_at,
								last_active,
								failed_at,
								failure_message,
								auto_title_attempted
						FROM sessions
						WHERE ${conditions.join(" AND ")}
						ORDER BY last_active DESC
						LIMIT $limit`,
					)
					.all(params) as Parameters<typeof mapSessionRows>[0],
			),
		);
	}

	delete(providerId: string, sdkSessionId: string) {
		this.db
			.query(
				`DELETE FROM sessions
				 WHERE agent_id = $agentId
				   AND provider_id = $providerId
				   AND sdk_session_id = $id`,
			)
			.run({
				$agentId: this.agentId,
				$providerId: providerId,
				$id: sdkSessionId,
			});
	}

	deleteAgentData(agentId: string) {
		this.db.transaction(() => {
			this.db
				.query("DELETE FROM sessions WHERE agent_id = $agentId")
				.run({ $agentId: agentId });
			this.stateStore.deleteAgentState(agentId);
		})();
	}

	rename(providerId: string, sdkSessionId: string, title: string) {
		this.db
			.query(
				`UPDATE sessions
				 SET title = $title
				 WHERE agent_id = $agentId
				   AND provider_id = $providerId
				   AND sdk_session_id = $id`,
			)
			.run({
				$agentId: this.agentId,
				$providerId: providerId,
				$id: sdkSessionId,
				$title: title,
			});
	}

	applyAutoTitle(params: {
		providerId: string;
		sdkSessionId: string;
		expectedTitle: string;
		title: string;
	}): boolean {
		return this.db.transaction(() => {
			const result = this.db
				.query(
					`UPDATE sessions
					 SET title = $title,
					     auto_title_attempted = 1
					 WHERE agent_id = $agentId
					   AND provider_id = $providerId
					   AND sdk_session_id = $id
					   AND tag = 'chat'
					   AND auto_title_attempted = 0
					   AND title = $expectedTitle`,
				)
				.run({
					$agentId: this.agentId,
					$providerId: params.providerId,
					$id: params.sdkSessionId,
					$expectedTitle: params.expectedTitle,
					$title: params.title,
				});

			if (result.changes > 0) {
				return true;
			}

			this.markAutoTitleAttempted(params.providerId, params.sdkSessionId);
			return false;
		})();
	}

	markAutoTitleAttempted(providerId: string, sdkSessionId: string) {
		this.db
			.query(
				`UPDATE sessions
				 SET auto_title_attempted = 1
				 WHERE agent_id = $agentId
				   AND provider_id = $providerId
				   AND sdk_session_id = $id
				   AND tag = 'chat'
				   AND auto_title_attempted = 0`,
			)
			.run({
				$agentId: this.agentId,
				$providerId: providerId,
				$id: sdkSessionId,
			});
	}

	getActiveSessionId(providerId: string): string | undefined {
		return this.stateStore.getActiveSessionId(providerId);
	}

	setActiveSessionId(providerId: string, id: string | undefined) {
		this.stateStore.setActiveSessionId(providerId, id);
	}

	getLastUserTarget(): LastUserTarget | undefined {
		return this.stateStore.getLastUserTarget();
	}

	setLastUserTarget(target: LastUserTarget | undefined) {
		this.stateStore.setLastUserTarget(target);
	}

	getLastInteractiveAt(): number | undefined {
		return this.stateStore.getLastInteractiveAt();
	}

	setLastInteractiveAt(timestamp: number | undefined) {
		this.stateStore.setLastInteractiveAt(timestamp);
	}

	getLastHandledRolloverInteractiveAt(): number | undefined {
		return this.stateStore.getLastHandledRolloverInteractiveAt();
	}

	setLastHandledRolloverInteractiveAt(timestamp: number | undefined) {
		this.stateStore.setLastHandledRolloverInteractiveAt(timestamp);
	}

	getRolloverNotice(): string | undefined {
		return this.stateStore.getRolloverNotice();
	}

	setRolloverNotice(message: string | undefined) {
		this.stateStore.setRolloverNotice(message);
	}

	getLastInteractiveAgentId(): string | undefined {
		return this.stateStore.getLastInteractiveAgentId();
	}

	setLastInteractiveAgentId(agentId: string | undefined) {
		this.stateStore.setLastInteractiveAgentId(agentId);
	}

	getFrontendNotice(): FrontendNotice | undefined {
		return this.stateStore.getFrontendNotice();
	}

	setFrontendNotice(notice: FrontendNotice | undefined) {
		this.stateStore.setFrontendNotice(notice);
	}

	setUsage(providerId: string, sdkSessionId: string, usage: UsageInfo) {
		this.usageStore.set(providerId, sdkSessionId, usage);
	}

	replaceTranscript(
		providerId: string,
		sdkSessionId: string,
		turns: TranscriptTurn[],
	) {
		this.transcriptIndex.replace(providerId, sdkSessionId, turns);
	}

	getUsage(providerId: string, sdkSessionId: string): UsageInfo | undefined {
		return this.usageStore.get(providerId, sdkSessionId);
	}

	close() {
		closeSqliteDatabase(this.db, this.dbFileKey);
	}

	private readIndexedAssistantText(
		providerId: string,
		sdkSessionId: string,
	): string {
		return (
			this.db
				.query(
					`SELECT body_text
					 FROM transcript_turns
					 WHERE agent_id = $agentId
					   AND provider_id = $providerId
					   AND sdk_session_id = $id
					   AND role = 'assistant'
					 ORDER BY turn_index ASC`,
				)
				.all({
					$agentId: this.agentId,
					$providerId: providerId,
					$id: sdkSessionId,
				}) as Array<{ body_text: string }>
		)
			.map((turn) => turn.body_text)
			.join("\n");
	}

	private withRecoveredConnection<T>(operation: () => T): T {
		try {
			return operation();
		} catch (error) {
			if (!isRetryableSqliteIoError(error)) {
				throw error;
			}

			this.reopenConnection();
			return operation();
		}
	}

	private reopenConnection() {
		try {
			closeSqliteDatabase(this.db, this.dbFileKey);
		} catch {
			// Ignore close failures from a broken connection and replace it below.
		}

		const sqlite = openSqliteDatabase(this.dbPath, this.journalMode);
		this.db = sqlite.db;
		this.dbFileKey = sqlite.fileKey;
		ensureSessionStoreSchema(this.db);
	}
}

function isRetryableSqliteIoError(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === "object" &&
			"code" in error &&
			typeof error.code === "string" &&
			error.code.startsWith("SQLITE_IOERR"),
	);
}
