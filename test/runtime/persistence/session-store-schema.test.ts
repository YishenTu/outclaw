import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { migrateSessionStore } from "../../../src/runtime/persistence/session-store-schema.ts";

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

		migrateSessionStore(db, "legacy");

		expect(hasTable(db, "state")).toBe(true);
		expect(hasTable(db, "sessions")).toBe(true);
		expect(getColumnNames(db, "sessions")).toEqual([
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

	test("adds missing tag and usage columns to a provider-scoped sessions table", () => {
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

		migrateSessionStore(db, "legacy");

		expect(getColumnNames(db, "sessions")).toEqual([
			"provider_id",
			"sdk_session_id",
			"title",
			"model",
			"source",
			"created_at",
			"last_active",
			"tag",
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

	test("rebuilds a legacy sessions table with provider ownership defaults", () => {
		const db = new Database(":memory:");
		databases.push(db);
		db.exec(`CREATE TABLE sessions (
			sdk_session_id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			model TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'tui',
			created_at INTEGER NOT NULL,
			last_active INTEGER NOT NULL
		)`);
		db.exec(`INSERT INTO sessions
			(sdk_session_id, title, model, source, created_at, last_active)
			VALUES ('sdk-legacy', 'Legacy', 'opus', 'tui', 1, 2)`);

		migrateSessionStore(db, "legacy-provider");

		const migrated = db
			.query(
				`SELECT provider_id, sdk_session_id, tag
				 FROM sessions
				 WHERE provider_id = 'legacy-provider' AND sdk_session_id = 'sdk-legacy'`,
			)
			.get() as { provider_id: string; sdk_session_id: string; tag: string };
		expect(migrated).toEqual({
			provider_id: "legacy-provider",
			sdk_session_id: "sdk-legacy",
			tag: "chat",
		});
	});
});
