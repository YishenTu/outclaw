import { Database } from "bun:sqlite";
import type { UsageInfo } from "../../common/protocol.ts";

export type SessionTag = "chat" | "cron";

export interface SessionRow {
	providerId: string;
	sdkSessionId: string;
	title: string;
	model: string;
	source: string;
	tag: SessionTag;
	createdAt: number;
	lastActive: number;
}

interface SessionStoreOptions {
	journalMode?: "WAL" | "DELETE";
	legacyProviderId?: string;
}

interface TableColumnInfo {
	name: string;
	pk: number;
}

const SESSION_USAGE_COLUMNS = [
	"input_tokens",
	"output_tokens",
	"cache_creation_tokens",
	"cache_read_tokens",
	"context_window",
	"max_output_tokens",
	"context_tokens",
	"percentage",
] as const;

const SESSION_TABLE_COLUMNS = [
	"provider_id",
	"sdk_session_id",
	"title",
	"model",
	"source",
	"tag",
	"created_at",
	"last_active",
	...SESSION_USAGE_COLUMNS,
] as const;

const LEGACY_ACTIVE_SESSION_KEY = "active_session_id";

export class SessionStore {
	private db: Database;
	private legacyProviderId: string;

	constructor(path: string, options: SessionStoreOptions = {}) {
		this.db = new Database(path, { create: true });
		this.db.exec(`PRAGMA journal_mode=${options.journalMode ?? "DELETE"}`);
		this.legacyProviderId = options.legacyProviderId ?? "legacy";
		this.migrate();
	}

	private migrate() {
		this.db.exec(`CREATE TABLE IF NOT EXISTS state (
				key TEXT PRIMARY KEY,
				value TEXT
			)`);

		const hasSessionsTable = Boolean(
			this.db
				.query(
					"SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'sessions'",
				)
				.get(),
		);

		if (!hasSessionsTable) {
			this.createSessionsTable();
			return;
		}

		const columns = this.getTableColumns("sessions");
		if (!usesProviderScopedPrimaryKey(columns)) {
			this.rebuildSessionsTable(columns);
			return;
		}

		this.ensureSessionColumns(columns);
	}

	private createSessionsTable() {
		this.db.exec(`CREATE TABLE IF NOT EXISTS sessions (
				provider_id TEXT NOT NULL,
				sdk_session_id TEXT NOT NULL,
				title TEXT NOT NULL,
				model TEXT NOT NULL,
				source TEXT NOT NULL DEFAULT 'tui',
				tag TEXT NOT NULL DEFAULT 'chat',
				created_at INTEGER NOT NULL,
				last_active INTEGER NOT NULL,
				input_tokens INTEGER,
				output_tokens INTEGER,
				cache_creation_tokens INTEGER,
				cache_read_tokens INTEGER,
				context_window INTEGER,
				max_output_tokens INTEGER,
				context_tokens INTEGER,
				percentage INTEGER,
				PRIMARY KEY (provider_id, sdk_session_id)
			)`);
	}

	private ensureSessionColumns(columns: TableColumnInfo[]) {
		if (!columns.some((column) => column.name === "tag")) {
			this.db.exec(
				"ALTER TABLE sessions ADD COLUMN tag TEXT NOT NULL DEFAULT 'chat'",
			);
		}

		for (const columnName of SESSION_USAGE_COLUMNS) {
			if (!columns.some((column) => column.name === columnName)) {
				this.db.exec(`ALTER TABLE sessions ADD COLUMN ${columnName} INTEGER`);
			}
		}
	}

	private rebuildSessionsTable(columns: TableColumnInfo[]) {
		this.db.exec("ALTER TABLE sessions RENAME TO sessions_legacy");
		this.createSessionsTable();

		const legacyColumns = new Set(columns.map((column) => column.name));
		const selectExpressions = SESSION_TABLE_COLUMNS.map((columnName) => {
			if (legacyColumns.has(columnName)) {
				return columnName;
			}

			switch (columnName) {
				case "provider_id":
					return `'${escapeSqlString(this.legacyProviderId)}' AS provider_id`;
				case "source":
					return "'tui' AS source";
				case "tag":
					return "'chat' AS tag";
				case "created_at":
				case "last_active":
					return `0 AS ${columnName}`;
				default:
					return `NULL AS ${columnName}`;
			}
		});

		this.db.exec(
			`INSERT INTO sessions (${SESSION_TABLE_COLUMNS.join(", ")})
			 SELECT ${selectExpressions.join(", ")}
			 FROM sessions_legacy`,
		);
		this.db.exec("DROP TABLE sessions_legacy");
	}

	private getTableColumns(tableName: string): TableColumnInfo[] {
		return this.db
			.query(`PRAGMA table_info(${tableName})`)
			.all() as TableColumnInfo[];
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
		const row = this.db
			.query(
				`SELECT provider_id, sdk_session_id, title, model, source, tag, created_at, last_active
				 FROM sessions
				 WHERE provider_id = $providerId AND sdk_session_id = $id`,
			)
			.get({
				$providerId: providerId,
				$id: sdkSessionId,
			}) as {
			provider_id: string;
			sdk_session_id: string;
			title: string;
			model: string;
			source: string;
			tag: SessionTag;
			created_at: number;
			last_active: number;
		} | null;

		if (!row) return undefined;
		return {
			providerId: row.provider_id,
			sdkSessionId: row.sdk_session_id,
			title: row.title,
			model: row.model,
			source: row.source,
			tag: row.tag,
			createdAt: row.created_at,
			lastActive: row.last_active,
		};
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
		const rows = this.db
			.query(
				`SELECT provider_id, sdk_session_id, title, model, source, tag, created_at, last_active
				 FROM sessions${whereClause}
				 ORDER BY last_active DESC
				 LIMIT $limit`,
			)
			.all(params) as Array<{
			provider_id: string;
			sdk_session_id: string;
			title: string;
			model: string;
			source: string;
			tag: SessionTag;
			created_at: number;
			last_active: number;
		}>;

		return rows.map((row) => ({
			providerId: row.provider_id,
			sdkSessionId: row.sdk_session_id,
			title: row.title,
			model: row.model,
			source: row.source,
			tag: row.tag,
			createdAt: row.created_at,
			lastActive: row.last_active,
		}));
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
		const row = this.db
			.query(
				`SELECT input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
						context_window, max_output_tokens, context_tokens, percentage
				FROM sessions
				WHERE provider_id = $providerId AND sdk_session_id = $id`,
			)
			.get({
				$providerId: providerId,
				$id: sdkSessionId,
			}) as {
			input_tokens: number | null;
			output_tokens: number | null;
			cache_creation_tokens: number | null;
			cache_read_tokens: number | null;
			context_window: number | null;
			max_output_tokens: number | null;
			context_tokens: number | null;
			percentage: number | null;
		} | null;
		if (!row || row.context_window === null) return undefined;
		return {
			inputTokens: row.input_tokens ?? 0,
			outputTokens: row.output_tokens ?? 0,
			cacheCreationTokens: row.cache_creation_tokens ?? 0,
			cacheReadTokens: row.cache_read_tokens ?? 0,
			contextWindow: row.context_window,
			maxOutputTokens: row.max_output_tokens ?? 0,
			contextTokens: row.context_tokens ?? 0,
			percentage: row.percentage ?? 0,
		};
	}

	close() {
		this.db.close();
	}
}

function activeSessionKey(providerId: string): string {
	return `active_session_id:${providerId}`;
}

function usesProviderScopedPrimaryKey(columns: TableColumnInfo[]): boolean {
	const primaryKey = columns
		.filter((column) => column.pk > 0)
		.sort((a, b) => a.pk - b.pk)
		.map((column) => column.name);

	return (
		primaryKey.length === 2 &&
		primaryKey[0] === "provider_id" &&
		primaryKey[1] === "sdk_session_id"
	);
}

function escapeSqlString(value: string): string {
	return value.replaceAll("'", "''");
}
