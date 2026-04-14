import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { ensureSessionStoreSchema } from "../../../src/runtime/persistence/session-store-schema.ts";

function getColumnNames(db: Database, tableName: string): string[] {
	return (
		db.query(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
	).map((column) => column.name);
}

function hasTable(db: Database, tableName: string): boolean {
	return Boolean(
		db
			.query(
				"SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = $name",
			)
			.get({ $name: tableName }),
	);
}

describe("session-store-schema", () => {
	const databases: Database[] = [];

	afterEach(() => {
		for (const database of databases.splice(0)) {
			database.close();
		}
	});

	test("creates the state and sessions tables for a fresh database", () => {
		const db = new Database(":memory:");
		databases.push(db);

		ensureSessionStoreSchema(db);

		expect(hasTable(db, "state")).toBe(true);
		expect(hasTable(db, "sessions")).toBe(true);
		expect(getColumnNames(db, "sessions")).toEqual([
			"agent_id",
			"provider_id",
			"sdk_session_id",
			"title",
			"model",
			"source",
			"tag",
			"created_at",
			"last_active",
			"input_tokens",
			"output_tokens",
			"cache_creation_tokens",
			"cache_read_tokens",
			"context_window",
			"max_output_tokens",
			"context_tokens",
			"percentage",
		]);
	});

	test("rejects provider-scoped pre-migration session tables", () => {
		const db = new Database(":memory:");
		databases.push(db);
		db.exec(`CREATE TABLE sessions (
			provider_id TEXT NOT NULL,
			sdk_session_id TEXT NOT NULL,
			title TEXT NOT NULL,
			model TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'tui',
			created_at INTEGER NOT NULL,
			last_active INTEGER NOT NULL,
			PRIMARY KEY (provider_id, sdk_session_id)
		)`);
		db.exec(`INSERT INTO sessions
			(provider_id, sdk_session_id, title, model, source, created_at, last_active)
			VALUES ('claude', 'sdk-123', 'Scoped', 'opus', 'tui', 1, 2)`);

		expect(() => ensureSessionStoreSchema(db)).toThrow(
			"Unsupported legacy session store schema",
		);
	});

	test("accepts an already-current session table", () => {
		const db = new Database(":memory:");
		databases.push(db);
		db.exec(`CREATE TABLE sessions (
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
		expect(() => ensureSessionStoreSchema(db)).not.toThrow();
	});
});
