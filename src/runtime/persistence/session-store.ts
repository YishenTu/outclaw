import type { Database } from "bun:sqlite";
import type { UsageInfo } from "../../common/protocol.ts";
import {
	mapSessionRow,
	mapSessionRows,
	mapUsageRow,
	type SessionRow,
	type SessionTag,
} from "./session-store-records.ts";
import { ensureSessionStoreSchema } from "./session-store-schema.ts";
import {
	closeSqliteDatabase,
	openSqliteDatabase,
} from "./sqlite-file-lifecycle.ts";
import {
	activeSessionKey,
	LAST_TUI_AGENT_KEY,
	lastTelegramDeliveryKey,
} from "./state-keys.ts";

interface SessionStoreOptions {
	agentId?: string;
	journalMode?: "WAL" | "DELETE";
}

interface TelegramDelivery {
	botId: string;
	chatId: number;
}

export type { SessionRow, SessionTag } from "./session-store-records.ts";

const DEFAULT_AGENT_ID = "agent-default";

export class SessionStore {
	private db: Database;
	private dbFileKey: string | undefined;
	private readonly agentId: string;
	private readonly dbPath: string;
	private readonly journalMode: "WAL" | "DELETE";

	constructor(path: string, options: SessionStoreOptions = {}) {
		this.dbPath = path;
		this.journalMode = options.journalMode ?? "WAL";
		this.agentId = options.agentId ?? DEFAULT_AGENT_ID;
		const sqlite = openSqliteDatabase(path, this.journalMode);
		this.db = sqlite.db;
		this.dbFileKey = sqlite.fileKey;
		try {
			ensureSessionStoreSchema(this.db);
		} catch (error) {
			closeSqliteDatabase(this.db, this.dbFileKey);
			throw error;
		}
	}

	upsert(params: {
		providerId: string;
		sdkSessionId: string;
		title: string;
		model: string;
		source?: string;
		tag?: SessionTag;
	}) {
		const now = Date.now();
		this.db
			.query(
				`INSERT INTO sessions (
					agent_id,
					provider_id,
					sdk_session_id,
					title,
					model,
					source,
					tag,
					created_at,
					last_active
				)
				VALUES (
					$agentId,
					$providerId,
					$id,
					$title,
					$model,
					$source,
					$tag,
					$now,
					$now
				)
				ON CONFLICT(agent_id, provider_id, sdk_session_id) DO UPDATE SET
					title = $title,
					model = $model,
					source = $source,
					tag = $tag,
					last_active = $now`,
			)
			.run({
				$agentId: this.agentId,
				$providerId: params.providerId,
				$id: params.sdkSessionId,
				$title: params.title,
				$model: params.model,
				$source: params.source ?? "tui",
				$tag: params.tag ?? "chat",
				$now: now,
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
						title,
						model,
						source,
						tag,
						created_at,
						last_active
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

		const conditions = [
			"agent_id = $agentId",
			"provider_id = $providerId",
			"sdk_session_id LIKE $prefix",
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
						title,
						model,
						source,
						tag,
						created_at,
						last_active
					FROM sessions
					WHERE ${conditions.join(" AND ")}
					ORDER BY last_active DESC
					LIMIT 1`,
				)
				.get(params) as Parameters<typeof mapSessionRow>[0],
		);
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
			this.db
				.query(
					`DELETE FROM state
					 WHERE key LIKE $activeSessionPrefix
					    OR key = $lastTelegramDeliveryKey`,
				)
				.run({
					$activeSessionPrefix: `${activeSessionKey(agentId, "")}%`,
					$lastTelegramDeliveryKey: lastTelegramDeliveryKey(agentId),
				});

			if (this.getLastTuiAgentId() === agentId) {
				this.deleteStateValue(LAST_TUI_AGENT_KEY);
			}
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

	getActiveSessionId(providerId: string): string | undefined {
		return this.getStateValue(activeSessionKey(this.agentId, providerId));
	}

	setActiveSessionId(providerId: string, id: string | undefined) {
		const key = activeSessionKey(this.agentId, providerId);
		if (id) {
			this.setStateValue(key, id);
			return;
		}

		this.deleteStateValue(key);
	}

	getLastTelegramChatId(): number | undefined {
		return this.getLastTelegramDelivery()?.chatId;
	}

	getLastTelegramDelivery(): TelegramDelivery | undefined {
		const value = this.getStateValue(lastTelegramDeliveryKey(this.agentId));
		if (!value) {
			return undefined;
		}

		try {
			const parsed = JSON.parse(value) as Partial<TelegramDelivery>;
			if (
				typeof parsed.botId === "string" &&
				typeof parsed.chatId === "number" &&
				Number.isFinite(parsed.chatId)
			) {
				return {
					botId: parsed.botId,
					chatId: parsed.chatId,
				};
			}
		} catch {
			return undefined;
		}

		return undefined;
	}

	setLastTelegramDelivery(delivery: TelegramDelivery | undefined) {
		if (!delivery) {
			this.deleteStateValue(lastTelegramDeliveryKey(this.agentId));
			return;
		}

		this.setStateValue(
			lastTelegramDeliveryKey(this.agentId),
			JSON.stringify(delivery),
		);
	}

	getLastTuiAgentId(): string | undefined {
		return this.getStateValue(LAST_TUI_AGENT_KEY);
	}

	setLastTuiAgentId(agentId: string | undefined) {
		if (!agentId) {
			this.deleteStateValue(LAST_TUI_AGENT_KEY);
			return;
		}

		this.setStateValue(LAST_TUI_AGENT_KEY, agentId);
	}

	setUsage(providerId: string, sdkSessionId: string, usage: UsageInfo) {
		this.db
			.query(
				`UPDATE sessions SET
					input_tokens = $inputTokens,
					output_tokens = $outputTokens,
					cache_creation_tokens = $cacheCreationTokens,
					cache_read_tokens = $cacheReadTokens,
					context_window = $contextWindow,
					max_output_tokens = $maxOutputTokens,
					context_tokens = $contextTokens,
					percentage = $percentage
				WHERE agent_id = $agentId
				  AND provider_id = $providerId
				  AND sdk_session_id = $id`,
			)
			.run({
				$agentId: this.agentId,
				$providerId: providerId,
				$id: sdkSessionId,
				$inputTokens: usage.inputTokens,
				$outputTokens: usage.outputTokens,
				$cacheCreationTokens: usage.cacheCreationTokens,
				$cacheReadTokens: usage.cacheReadTokens,
				$contextWindow: usage.contextWindow,
				$maxOutputTokens: usage.maxOutputTokens,
				$contextTokens: usage.contextTokens,
				$percentage: usage.percentage,
			});
	}

	getUsage(providerId: string, sdkSessionId: string): UsageInfo | undefined {
		return mapUsageRow(
			this.db
				.query(
					`SELECT
						input_tokens,
						output_tokens,
						cache_creation_tokens,
						cache_read_tokens,
						context_window,
						max_output_tokens,
						context_tokens,
						percentage
					FROM sessions
					WHERE agent_id = $agentId
					  AND provider_id = $providerId
					  AND sdk_session_id = $id`,
				)
				.get({
					$agentId: this.agentId,
					$providerId: providerId,
					$id: sdkSessionId,
				}) as Parameters<typeof mapUsageRow>[0],
		);
	}

	close() {
		closeSqliteDatabase(this.db, this.dbFileKey);
	}

	private deleteStateValue(key: string) {
		this.db.query("DELETE FROM state WHERE key = $key").run({ $key: key });
	}

	private getStateValue(key: string): string | undefined {
		const row = this.db
			.query("SELECT value FROM state WHERE key = $key")
			.get({ $key: key }) as { value: string | null } | null;
		return row?.value ?? undefined;
	}

	private setStateValue(key: string, value: string) {
		this.db
			.query("INSERT OR REPLACE INTO state (key, value) VALUES ($key, $value)")
			.run({ $key: key, $value: value });
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
