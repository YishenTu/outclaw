import type { Database } from "bun:sqlite";
import {
	SESSION_TABLE_COLUMNS,
	type TableColumnInfo,
} from "./session-store-records.ts";

export function ensureSessionStoreSchema(db: Database) {
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
		createTranscriptTables(db);
		return;
	}

	const columns = getTableColumns(db, "sessions");
	assertCurrentSessionsTable(columns);
	createTranscriptTables(db);
}

function createSessionsTable(db: Database) {
	db.exec(`CREATE TABLE IF NOT EXISTS sessions (
			agent_id TEXT NOT NULL,
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
				PRIMARY KEY (agent_id, provider_id, sdk_session_id)
				)`);
}

function createTranscriptTables(db: Database) {
	db.exec(`CREATE TABLE IF NOT EXISTS transcript_turns (
			agent_id TEXT NOT NULL,
			provider_id TEXT NOT NULL,
			sdk_session_id TEXT NOT NULL,
			turn_index INTEGER NOT NULL,
			role TEXT NOT NULL,
			body_text TEXT NOT NULL,
			timestamp INTEGER NOT NULL,
			PRIMARY KEY (agent_id, provider_id, sdk_session_id, turn_index),
			FOREIGN KEY (agent_id, provider_id, sdk_session_id)
				REFERENCES sessions(agent_id, provider_id, sdk_session_id)
				ON DELETE CASCADE
		)`);

	db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS transcript_turns_fts USING fts5(
			body_text,
			content='transcript_turns',
			content_rowid='rowid'
		)`);

	db.exec(`CREATE TRIGGER IF NOT EXISTS transcript_turns_ai
		AFTER INSERT ON transcript_turns BEGIN
			INSERT INTO transcript_turns_fts(rowid, body_text)
			VALUES (new.rowid, new.body_text);
		END`);
	db.exec(`CREATE TRIGGER IF NOT EXISTS transcript_turns_ad
		AFTER DELETE ON transcript_turns BEGIN
			INSERT INTO transcript_turns_fts(transcript_turns_fts, rowid, body_text)
			VALUES ('delete', old.rowid, old.body_text);
		END`);
	db.exec(`CREATE TRIGGER IF NOT EXISTS transcript_turns_au
		AFTER UPDATE ON transcript_turns BEGIN
			INSERT INTO transcript_turns_fts(transcript_turns_fts, rowid, body_text)
			VALUES ('delete', old.rowid, old.body_text);
			INSERT INTO transcript_turns_fts(rowid, body_text)
			VALUES (new.rowid, new.body_text);
		END`);
}

function getTableColumns(db: Database, tableName: string): TableColumnInfo[] {
	return db.query(`PRAGMA table_info(${tableName})`).all() as TableColumnInfo[];
}

function usesAgentScopedPrimaryKey(columns: TableColumnInfo[]): boolean {
	const primaryKey = columns
		.filter((column) => column.pk > 0)
		.sort((a, b) => a.pk - b.pk)
		.map((column) => column.name);

	return (
		primaryKey.length === 3 &&
		primaryKey[0] === "agent_id" &&
		primaryKey[1] === "provider_id" &&
		primaryKey[2] === "sdk_session_id"
	);
}

function assertCurrentSessionsTable(columns: TableColumnInfo[]) {
	if (!usesAgentScopedPrimaryKey(columns)) {
		throw new Error("Unsupported legacy session store schema");
	}

	const columnNames = new Set(columns.map((column) => column.name));
	for (const columnName of SESSION_TABLE_COLUMNS) {
		if (!columnNames.has(columnName)) {
			throw new Error("Unsupported legacy session store schema");
		}
	}
}
