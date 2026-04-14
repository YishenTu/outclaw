import type { Database } from "bun:sqlite";
import {
	closeSqliteDatabase,
	openSqliteDatabase,
} from "./sqlite-file-lifecycle.ts";

interface TelegramRouteStoreOptions {
	journalMode?: "WAL" | "DELETE";
}

export class TelegramRouteStore {
	private db: Database;
	private dbFileKey: string | undefined;

	constructor(path: string, options: TelegramRouteStoreOptions = {}) {
		const sqlite = openSqliteDatabase(path, options.journalMode ?? "WAL");
		this.db = sqlite.db;
		this.dbFileKey = sqlite.fileKey;
		this.db.exec(`CREATE TABLE IF NOT EXISTS telegram_routes (
			bot_id TEXT NOT NULL,
			telegram_user_id INTEGER NOT NULL,
			agent_id TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (bot_id, telegram_user_id)
		)`);
	}

	setAgentId(botId: string, telegramUserId: number, agentId: string) {
		this.db
			.query(
				`INSERT INTO telegram_routes
					(bot_id, telegram_user_id, agent_id, created_at)
				VALUES ($botId, $telegramUserId, $agentId, $createdAt)
				ON CONFLICT(bot_id, telegram_user_id) DO UPDATE SET
					agent_id = $agentId`,
			)
			.run({
				$botId: botId,
				$telegramUserId: telegramUserId,
				$agentId: agentId,
				$createdAt: Date.now(),
			});
	}

	getAgentId(botId: string, telegramUserId: number): string | undefined {
		const row = this.db
			.query(
				`SELECT agent_id
				 FROM telegram_routes
				 WHERE bot_id = $botId AND telegram_user_id = $telegramUserId`,
			)
			.get({
				$botId: botId,
				$telegramUserId: telegramUserId,
			}) as { agent_id: string } | null;
		return row?.agent_id;
	}

	delete(botId: string, telegramUserId: number) {
		this.db
			.query(
				`DELETE FROM telegram_routes
				 WHERE bot_id = $botId AND telegram_user_id = $telegramUserId`,
			)
			.run({
				$botId: botId,
				$telegramUserId: telegramUserId,
			});
	}

	deleteByAgentId(agentId: string) {
		this.db
			.query("DELETE FROM telegram_routes WHERE agent_id = $agentId")
			.run({ $agentId: agentId });
	}

	close() {
		closeSqliteDatabase(this.db, this.dbFileKey);
	}
}
