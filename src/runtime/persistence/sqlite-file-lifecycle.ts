import { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";
import { resolve } from "node:path";

export type SqliteJournalMode = "WAL" | "DELETE";

interface OpenSqliteDatabaseResult {
	db: Database;
	fileKey: string | undefined;
}

const openConnectionCounts = new Map<string, number>();

export function openSqliteDatabase(
	path: string,
	journalMode: SqliteJournalMode,
): OpenSqliteDatabaseResult {
	const db = new Database(path, { create: true });
	const fileKey = getSqliteFileKey(path);
	if (fileKey) {
		retainConnection(fileKey);
	}

	try {
		db.exec(`PRAGMA journal_mode=${journalMode}`);
		return { db, fileKey };
	} catch (error) {
		try {
			db.close();
		} finally {
			if (fileKey) {
				releaseConnection(fileKey);
			}
		}
		throw error;
	}
}

export function closeSqliteDatabase(db: Database, fileKey: string | undefined) {
	if (!fileKey) {
		db.close();
		return;
	}

	const shouldFinalize = (openConnectionCounts.get(fileKey) ?? 0) <= 1;
	let canRemoveSidecars = false;

	try {
		if (shouldFinalize) {
			canRemoveSidecars = finalizeWalMode(db);
		}
	} finally {
		try {
			db.close();
		} finally {
			releaseConnection(fileKey);
		}
	}

	if (shouldFinalize && canRemoveSidecars) {
		removeSidecarFiles(fileKey);
	}
}

function finalizeWalMode(db: Database): boolean {
	try {
		db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		const row = db.query("PRAGMA journal_mode=DELETE").get() as {
			journal_mode?: string;
		} | null;
		return row?.journal_mode === "delete";
	} catch {
		// Another process may still hold the database open.
		return false;
	}
}

function getSqliteFileKey(path: string): string | undefined {
	if (path === ":memory:") {
		return undefined;
	}

	return resolve(path);
}

function retainConnection(fileKey: string) {
	openConnectionCounts.set(
		fileKey,
		(openConnectionCounts.get(fileKey) ?? 0) + 1,
	);
}

function releaseConnection(fileKey: string) {
	const nextCount = (openConnectionCounts.get(fileKey) ?? 1) - 1;
	if (nextCount <= 0) {
		openConnectionCounts.delete(fileKey);
		return;
	}

	openConnectionCounts.set(fileKey, nextCount);
}

function removeSidecarFiles(fileKey: string) {
	for (const suffix of ["-wal", "-shm"]) {
		try {
			unlinkSync(`${fileKey}${suffix}`);
		} catch {
			// Already removed by SQLite or does not exist.
		}
	}
}
