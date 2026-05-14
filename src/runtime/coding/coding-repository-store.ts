import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
	closeSqliteDatabase,
	openSqliteDatabase,
	type SqliteJournalMode,
} from "../persistence/session-store/sqlite-file-lifecycle.ts";

export type CodingRepositorySource = "auto" | "manual" | "clone";
export type CodingRepositoryStatus = "active" | "archived";

export interface CodingRepositoryRecord {
	id: string;
	rootCwd: string;
	displayName: string;
	remoteUrl?: string;
	source: CodingRepositorySource;
	status: CodingRepositoryStatus;
	terminalRunCommand: string;
	createdAt: number;
	lastActive: number;
	archivedAt?: number;
}

interface CodingRepositoryStoreOptions {
	journalMode?: SqliteJournalMode;
}

interface CodingRepositoryDatabaseRow {
	id: string;
	root_cwd: string;
	display_name: string;
	remote_url: string | null;
	source: CodingRepositorySource;
	status: CodingRepositoryStatus;
	terminal_run_command: string;
	created_at: number;
	last_active: number;
	archived_at: number | null;
}

interface TableColumnInfo {
	name: string;
}

export class CodingRepositoryStore {
	private readonly db: Database;
	private readonly dbFileKey: string | undefined;

	constructor(path: string, options: CodingRepositoryStoreOptions = {}) {
		const sqlite = openSqliteDatabase(path, options.journalMode ?? "WAL");
		this.db = sqlite.db;
		this.dbFileKey = sqlite.fileKey;

		try {
			ensureCodingRepositoryStoreSchema(this.db);
		} catch (error) {
			closeSqliteDatabase(this.db, this.dbFileKey);
			throw error;
		}
	}

	register(params: {
		displayName?: string;
		remoteUrl?: string;
		rootCwd: string;
		source: CodingRepositorySource;
		timestamp?: number;
	}): CodingRepositoryRecord {
		const now = params.timestamp ?? Date.now();
		const rootCwd = canonicalizePath(params.rootCwd);
		const displayName = params.displayName ?? basename(rootCwd);
		this.db
			.query(
				`INSERT INTO coding_repositories (
					id,
					root_cwd,
					display_name,
					remote_url,
					source,
					status,
					created_at,
					last_active,
					archived_at
				)
				VALUES (
					$id,
					$rootCwd,
					$displayName,
					$remoteUrl,
					$source,
					'active',
					$now,
					$now,
					NULL
				)
				ON CONFLICT(root_cwd) DO UPDATE SET
					display_name = $displayName,
					remote_url = COALESCE($remoteUrl, remote_url),
					source = CASE
						WHEN $source = 'auto' AND source <> 'auto' THEN source
						ELSE $source
					END,
					status = 'active',
					last_active = $now,
					archived_at = NULL`,
			)
			.run({
				$id: randomUUID(),
				$rootCwd: rootCwd,
				$displayName: displayName,
				$remoteUrl: params.remoteUrl ?? null,
				$source: params.source,
				$now: now,
			});

		const repository = this.getByRoot(rootCwd);
		if (!repository) {
			throw new Error(`Failed to register coding repository: ${rootCwd}`);
		}
		return repository;
	}

	registerForCwd(params: {
		cwd: string;
		timestamp?: number;
	}): CodingRepositoryRecord {
		const rootCwd = resolveCodingRepositoryRoot(params.cwd);
		return this.register({
			rootCwd,
			source: "auto",
			timestamp: params.timestamp,
		});
	}

	archive(id: string, timestamp?: number) {
		const now = timestamp ?? Date.now();
		this.db
			.query(
				`UPDATE coding_repositories
				 SET status = 'archived',
				     archived_at = $now,
				     last_active = $now
				 WHERE id = $id`,
			)
			.run({ $id: id, $now: now });
	}

	restore(id: string, timestamp?: number) {
		const now = timestamp ?? Date.now();
		this.db
			.query(
				`UPDATE coding_repositories
				 SET status = 'active',
				     archived_at = NULL,
				     last_active = $now
				 WHERE id = $id`,
			)
			.run({ $id: id, $now: now });
	}

	get(id: string): CodingRepositoryRecord | undefined {
		return mapCodingRepositoryRow(
			this.db
				.query(
					`SELECT
						id,
						root_cwd,
						display_name,
						remote_url,
						source,
						status,
						terminal_run_command,
						created_at,
						last_active,
						archived_at
					FROM coding_repositories
					WHERE id = $id`,
				)
				.get({ $id: id }) as CodingRepositoryDatabaseRow | null,
		);
	}

	getByRoot(rootCwd: string): CodingRepositoryRecord | undefined {
		return mapCodingRepositoryRow(
			this.db
				.query(
					`SELECT
						id,
						root_cwd,
						display_name,
						remote_url,
						source,
						status,
						terminal_run_command,
						created_at,
						last_active,
						archived_at
					FROM coding_repositories
					WHERE root_cwd = $rootCwd`,
				)
				.get({
					$rootCwd: canonicalizePath(rootCwd),
				}) as CodingRepositoryDatabaseRow | null,
		);
	}

	list(options: { includeArchived?: boolean } = {}): CodingRepositoryRecord[] {
		const where = options.includeArchived ? "" : "WHERE status = 'active'";
		return (
			this.db
				.query(
					`SELECT
						id,
						root_cwd,
						display_name,
						remote_url,
						source,
						status,
						terminal_run_command,
						created_at,
						last_active,
						archived_at
					FROM coding_repositories
					${where}
					ORDER BY last_active DESC, display_name ASC`,
				)
				.all() as CodingRepositoryDatabaseRow[]
		).map(mapRequiredCodingRepositoryRow);
	}

	writeTerminalRunCommand(
		id: string,
		command: string,
		timestamp?: number,
	): CodingRepositoryRecord {
		const now = timestamp ?? Date.now();
		this.db
			.query(
				`UPDATE coding_repositories
				 SET terminal_run_command = $command,
				     last_active = $now
				 WHERE id = $id`,
			)
			.run({ $command: command, $id: id, $now: now });

		const repository = this.get(id);
		if (!repository) {
			throw new Error(`Unknown coding repository: ${id}`);
		}
		return repository;
	}

	close() {
		closeSqliteDatabase(this.db, this.dbFileKey);
	}
}

export function ensureCodingRepositoryStoreSchema(db: Database) {
	db.exec(`CREATE TABLE IF NOT EXISTS coding_repositories (
		id TEXT PRIMARY KEY,
		root_cwd TEXT NOT NULL UNIQUE,
		display_name TEXT NOT NULL,
		remote_url TEXT,
		source TEXT NOT NULL,
		status TEXT NOT NULL,
		terminal_run_command TEXT NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL,
		last_active INTEGER NOT NULL,
		archived_at INTEGER
	)`);

	const columns = getTableColumns(db, "coding_repositories");
	if (!columns.some((column) => column.name === "terminal_run_command")) {
		db.exec(
			"ALTER TABLE coding_repositories ADD COLUMN terminal_run_command TEXT NOT NULL DEFAULT ''",
		);
	}
}

export function resolveCodingRepositoryRoot(cwd: string): string {
	let current = canonicalizePath(cwd);
	while (true) {
		if (existsSync(resolve(current, ".git"))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) {
			return canonicalizePath(cwd);
		}
		current = parent;
	}
}

function canonicalizePath(path: string): string {
	const absolute = resolve(path);
	return existsSync(absolute) ? realpathSync(absolute) : absolute;
}

function mapCodingRepositoryRow(
	row: CodingRepositoryDatabaseRow | null | undefined,
): CodingRepositoryRecord | undefined {
	if (!row) {
		return undefined;
	}

	return mapRequiredCodingRepositoryRow(row);
}

function mapRequiredCodingRepositoryRow(
	row: CodingRepositoryDatabaseRow,
): CodingRepositoryRecord {
	return {
		id: row.id,
		rootCwd: row.root_cwd,
		displayName: row.display_name,
		remoteUrl: row.remote_url ?? undefined,
		source: row.source,
		status: row.status,
		terminalRunCommand: row.terminal_run_command,
		createdAt: row.created_at,
		lastActive: row.last_active,
		...(row.archived_at !== null ? { archivedAt: row.archived_at } : {}),
	};
}

function getTableColumns(db: Database, tableName: string): TableColumnInfo[] {
	return db.query(`PRAGMA table_info(${tableName})`).all() as TableColumnInfo[];
}
