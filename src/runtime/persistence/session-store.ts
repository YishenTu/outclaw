import { Database } from "bun:sqlite";

export type SessionTag = "chat" | "cron";

export interface SessionRow {
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
}

export class SessionStore {
	private db: Database;

	constructor(path: string, options: SessionStoreOptions = {}) {
		this.db = new Database(path, { create: true });
		this.db.exec(`PRAGMA journal_mode=${options.journalMode ?? "DELETE"}`);
		this.migrate();
	}

	private migrate() {
		this.db.exec(`CREATE TABLE IF NOT EXISTS sessions (
				sdk_session_id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				model TEXT NOT NULL,
				source TEXT NOT NULL DEFAULT 'tui',
				tag TEXT NOT NULL DEFAULT 'chat',
				created_at INTEGER NOT NULL,
				last_active INTEGER NOT NULL
			)`);
		this.db.exec(`CREATE TABLE IF NOT EXISTS state (
				key TEXT PRIMARY KEY,
				value TEXT
			)`);

		const columns = this.db
			.query("PRAGMA table_info(sessions)")
			.all() as Array<{
			name: string;
		}>;
		if (!columns.some((column) => column.name === "tag")) {
			this.db.exec(
				"ALTER TABLE sessions ADD COLUMN tag TEXT NOT NULL DEFAULT 'chat'",
			);
		}
	}

	upsert(params: {
		sdkSessionId: string;
		title: string;
		model: string;
		source?: string;
		tag?: SessionTag;
	}) {
		const now = Date.now();
		this.db
			.query(
				`INSERT INTO sessions (sdk_session_id, title, model, source, tag, created_at, last_active)
				 VALUES ($id, $title, $model, $source, $tag, $now, $now)
				 ON CONFLICT(sdk_session_id) DO UPDATE SET
					title = $title, model = $model, source = $source, tag = $tag, last_active = $now`,
			)
			.run({
				$id: params.sdkSessionId,
				$title: params.title,
				$model: params.model,
				$source: params.source ?? "tui",
				$tag: params.tag ?? "chat",
				$now: now,
			});
	}

	get(sdkSessionId: string): SessionRow | undefined {
		const row = this.db
			.query(
				"SELECT sdk_session_id, title, model, source, tag, created_at, last_active FROM sessions WHERE sdk_session_id = $id",
			)
			.get({ $id: sdkSessionId }) as {
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
			sdkSessionId: row.sdk_session_id,
			title: row.title,
			model: row.model,
			source: row.source,
			tag: row.tag,
			createdAt: row.created_at,
			lastActive: row.last_active,
		};
	}

	list(limit = 20, tag?: SessionTag): SessionRow[] {
		const rows = this.db
			.query(
				tag
					? "SELECT sdk_session_id, title, model, source, tag, created_at, last_active FROM sessions WHERE tag = $tag ORDER BY last_active DESC LIMIT $limit"
					: "SELECT sdk_session_id, title, model, source, tag, created_at, last_active FROM sessions ORDER BY last_active DESC LIMIT $limit",
			)
			.all(tag ? { $limit: limit, $tag: tag } : { $limit: limit }) as Array<{
			sdk_session_id: string;
			title: string;
			model: string;
			source: string;
			tag: SessionTag;
			created_at: number;
			last_active: number;
		}>;

		return rows.map((row) => ({
			sdkSessionId: row.sdk_session_id,
			title: row.title,
			model: row.model,
			source: row.source,
			tag: row.tag,
			createdAt: row.created_at,
			lastActive: row.last_active,
		}));
	}

	delete(sdkSessionId: string) {
		this.db
			.query("DELETE FROM sessions WHERE sdk_session_id = $id")
			.run({ $id: sdkSessionId });
	}

	rename(sdkSessionId: string, title: string) {
		this.db
			.query("UPDATE sessions SET title = $title WHERE sdk_session_id = $id")
			.run({ $id: sdkSessionId, $title: title });
	}

	getActiveSessionId(): string | undefined {
		const row = this.db
			.query("SELECT value FROM state WHERE key = 'active_session_id'")
			.get() as { value: string | null } | null;
		return row?.value ?? undefined;
	}

	setActiveSessionId(id: string | undefined) {
		if (id) {
			this.setStateValue("active_session_id", id);
		} else {
			this.deleteStateValue("active_session_id");
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

	close() {
		this.db.close();
	}
}
