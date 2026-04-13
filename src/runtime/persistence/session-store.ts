import type { Database } from "bun:sqlite";
import type { UsageInfo } from "../../common/protocol.ts";
import {
	mapSessionRow,
	mapSessionRows,
	mapUsageRow,
	type SessionRow,
	type SessionTag,
} from "./session-store-records.ts";
import { migrateSessionStore } from "./session-store-schema.ts";
import {
	closeSqliteDatabase,
	openSqliteDatabase,
} from "./sqlite-file-lifecycle.ts";

interface SessionStoreOptions {
	journalMode?: "WAL" | "DELETE";
	legacyProviderId?: string;
}

export type { SessionRow, SessionTag } from "./session-store-records.ts";

const LEGACY_ACTIVE_SESSION_KEY = "active_session_id";

export class SessionStore {
	private db: Database;
	private dbFileKey: string | undefined;
	private legacyProviderId: string;

	constructor(path: string, options: SessionStoreOptions = {}) {
		const sqlite = openSqliteDatabase(path, options.journalMode ?? "WAL");
		this.db = sqlite.db;
		this.dbFileKey = sqlite.fileKey;
		this.legacyProviderId = options.legacyProviderId ?? "legacy";
		migrateSessionStore(this.db, this.legacyProviderId);
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
				`INSERT INTO sessions (provider_id, sdk_session_id, title, model, source, tag, created_at, last_active)
				 VALUES ($providerId, $id, $title, $model, $source, $tag, $now, $now)
				 ON CONFLICT(provider_id, sdk_session_id) DO UPDATE SET
					title = $title, model = $model, source = $source, tag = $tag, last_active = $now`,
			)
			.run({
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
					`SELECT provider_id, sdk_session_id, title, model, source, tag, created_at, last_active
				 FROM sessions
				 WHERE provider_id = $providerId AND sdk_session_id = $id`,
				)
				.get({
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
			"provider_id = $providerId",
			"sdk_session_id LIKE $prefix",
		];
		const params: Record<string, string> = {
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
					`SELECT provider_id, sdk_session_id, title, model, source, tag, created_at, last_active
				 FROM sessions
				 WHERE ${conditions.join(" AND ")}
				 ORDER BY last_active DESC
				 LIMIT 1`,
				)
				.get(params) as Parameters<typeof mapSessionRow>[0],
		);
	}

	list(limit = 20, tag?: SessionTag, providerId?: string): SessionRow[] {
		const conditions: string[] = [];
		const params: Record<string, string | number> = { $limit: limit };

		if (providerId) {
			conditions.push("provider_id = $providerId");
			params.$providerId = providerId;
		}
		if (tag) {
			conditions.push("tag = $tag");
			params.$tag = tag;
		}

		const whereClause =
			conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
		return mapSessionRows(
			this.db
				.query(
					`SELECT provider_id, sdk_session_id, title, model, source, tag, created_at, last_active
				 FROM sessions${whereClause}
				 ORDER BY last_active DESC
				 LIMIT $limit`,
				)
				.all(params) as Parameters<typeof mapSessionRows>[0],
		);
	}

	delete(providerId: string, sdkSessionId: string) {
		this.db
			.query(
				"DELETE FROM sessions WHERE provider_id = $providerId AND sdk_session_id = $id",
			)
			.run({
				$providerId: providerId,
				$id: sdkSessionId,
			});
	}

	rename(providerId: string, sdkSessionId: string, title: string) {
		this.db
			.query(
				`UPDATE sessions
				 SET title = $title
				 WHERE provider_id = $providerId AND sdk_session_id = $id`,
			)
			.run({
				$providerId: providerId,
				$id: sdkSessionId,
				$title: title,
			});
	}

	getActiveSessionId(providerId: string): string | undefined {
		const providerScopedValue = this.getStateValue(
			activeSessionKey(providerId),
		);
		if (providerScopedValue !== undefined) {
			return providerScopedValue;
		}

		if (providerId === this.legacyProviderId) {
			return this.getStateValue(LEGACY_ACTIVE_SESSION_KEY);
		}

		return undefined;
	}

	setActiveSessionId(providerId: string, id: string | undefined) {
		const key = activeSessionKey(providerId);
		if (id) {
			this.setStateValue(key, id);
			if (providerId === this.legacyProviderId) {
				this.setStateValue(LEGACY_ACTIVE_SESSION_KEY, id);
			}
			return;
		}

		this.deleteStateValue(key);
		if (providerId === this.legacyProviderId) {
			this.deleteStateValue(LEGACY_ACTIVE_SESSION_KEY);
		}
	}

	getLastTelegramChatId(): number | undefined {
		const value = this.getStateValue("last_telegram_chat_id");
		if (!value) {
			return undefined;
		}

		const chatId = Number(value);
		return Number.isFinite(chatId) ? chatId : undefined;
	}

	setLastTelegramChatId(chatId: number | undefined) {
		if (chatId === undefined) {
			this.deleteStateValue("last_telegram_chat_id");
			return;
		}

		this.setStateValue("last_telegram_chat_id", String(chatId));
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
				WHERE provider_id = $providerId AND sdk_session_id = $id`,
			)
			.run({
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
					`SELECT input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
						context_window, max_output_tokens, context_tokens, percentage
				FROM sessions
				WHERE provider_id = $providerId AND sdk_session_id = $id`,
				)
				.get({
					$providerId: providerId,
					$id: sdkSessionId,
				}) as Parameters<typeof mapUsageRow>[0],
		);
	}

	close() {
		closeSqliteDatabase(this.db, this.dbFileKey);
	}
}

function activeSessionKey(providerId: string): string {
	return `active_session_id:${providerId}`;
}
