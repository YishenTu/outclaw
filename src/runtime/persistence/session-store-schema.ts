import type { Database } from "bun:sqlite";
import {
	SESSION_TABLE_COLUMNS,
	SESSION_USAGE_COLUMNS,
	type TableColumnInfo,
} from "./session-store-records.ts";

export function migrateSessionStore(db: Database, legacyProviderId: string) {
	db.exec(`CREATE TABLE IF NOT EXISTS state (
			key TEXT PRIMARY KEY,
			value TEXT
		)`);

	const hasSessionsTable = Boolean(
		db
			.query(
				"SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'sessions'",
			)
			.get(),
	);

	if (!hasSessionsTable) {
		createSessionsTable(db);
		return;
	}

	const columns = getTableColumns(db, "sessions");
	if (!usesProviderScopedPrimaryKey(columns)) {
		rebuildSessionsTable(db, columns, legacyProviderId);
		return;
	}

	ensureSessionColumns(db, columns);
}

function createSessionsTable(db: Database) {
	db.exec(`CREATE TABLE IF NOT EXISTS sessions (
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

function ensureSessionColumns(db: Database, columns: TableColumnInfo[]) {
	if (!columns.some((column) => column.name === "tag")) {
		db.exec("ALTER TABLE sessions ADD COLUMN tag TEXT NOT NULL DEFAULT 'chat'");
	}

	for (const columnName of SESSION_USAGE_COLUMNS) {
		if (!columns.some((column) => column.name === columnName)) {
			db.exec(`ALTER TABLE sessions ADD COLUMN ${columnName} INTEGER`);
		}
	}
}

function rebuildSessionsTable(
	db: Database,
	columns: TableColumnInfo[],
	legacyProviderId: string,
) {
	db.exec("ALTER TABLE sessions RENAME TO sessions_legacy");
	createSessionsTable(db);

	const legacyColumns = new Set(columns.map((column) => column.name));
	const selectExpressions = SESSION_TABLE_COLUMNS.map((columnName) => {
		if (legacyColumns.has(columnName)) {
			return columnName;
		}

		switch (columnName) {
			case "provider_id":
				return `'${escapeSqlString(legacyProviderId)}' AS provider_id`;
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

	db.exec(
		`INSERT INTO sessions (${SESSION_TABLE_COLUMNS.join(", ")})
		 SELECT ${selectExpressions.join(", ")}
		 FROM sessions_legacy`,
	);
	db.exec("DROP TABLE sessions_legacy");
}

function getTableColumns(db: Database, tableName: string): TableColumnInfo[] {
	return db.query(`PRAGMA table_info(${tableName})`).all() as TableColumnInfo[];
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
