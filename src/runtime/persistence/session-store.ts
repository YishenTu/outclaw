import { Database } from "bun:sqlite";

export interface SessionRow {
	sdkSessionId: string;
	title: string;
	model: string;
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
		this.db.exec(`PRAGMA journal_mode=${options.journalMode ?? "WAL"}`);
		this.migrate();
	}

	private migrate() {
		this.db.exec(`CREATE TABLE IF NOT EXISTS sessions (
			sdk_session_id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			model TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			last_active INTEGER NOT NULL
		)`);
		this.db.exec(`CREATE TABLE IF NOT EXISTS state (
			key TEXT PRIMARY KEY,
			value TEXT
		)`);
	}

	upsert(params: { sdkSessionId: string; title: string; model: string }) {
		const now = Date.now();
		this.db
			.query(
				`INSERT INTO sessions (sdk_session_id, title, model, created_at, last_active)
			 VALUES ($id, $title, $model, $now, $now)
			 ON CONFLICT(sdk_session_id) DO UPDATE SET
				title = $title, model = $model, last_active = $now`,
			)
			.run({
				$id: params.sdkSessionId,
				$title: params.title,
				$model: params.model,
				$now: now,
			});
	}

	get(sdkSessionId: string): SessionRow | undefined {
		const row = this.db
			.query(
				"SELECT sdk_session_id, title, model, created_at, last_active FROM sessions WHERE sdk_session_id = $id",
			)
			.get({ $id: sdkSessionId }) as {
			sdk_session_id: string;
			title: string;
			model: string;
			created_at: number;
			last_active: number;
		} | null;

		if (!row) return undefined;
		return {
			sdkSessionId: row.sdk_session_id,
			title: row.title,
			model: row.model,
			createdAt: row.created_at,
			lastActive: row.last_active,
		};
	}

	list(limit = 20): SessionRow[] {
		const rows = this.db
			.query(
				"SELECT sdk_session_id, title, model, created_at, last_active FROM sessions ORDER BY last_active DESC LIMIT $limit",
			)
			.all({ $limit: limit }) as Array<{
			sdk_session_id: string;
			title: string;
			model: string;
			created_at: number;
			last_active: number;
		}>;

		return rows.map((row) => ({
			sdkSessionId: row.sdk_session_id,
			title: row.title,
			model: row.model,
			createdAt: row.created_at,
			lastActive: row.last_active,
		}));
	}

	getActiveSessionId(): string | undefined {
		const row = this.db
			.query("SELECT value FROM state WHERE key = 'active_session_id'")
			.get() as { value: string | null } | null;
		return row?.value ?? undefined;
	}

	setActiveSessionId(id: string | undefined) {
		if (id) {
			this.db
				.query(
					"INSERT OR REPLACE INTO state (key, value) VALUES ('active_session_id', $id)",
				)
				.run({ $id: id });
		} else {
			this.db.query("DELETE FROM state WHERE key = 'active_session_id'").run();
		}
	}

	close() {
		this.db.close();
	}
}
