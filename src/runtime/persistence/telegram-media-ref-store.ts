import { Database } from "bun:sqlite";
import type { ImageMediaType } from "../../common/protocol.ts";

export type TelegramMediaDirection = "inbound" | "outbound";

export interface TelegramMediaRefRow {
	chatId: number;
	messageId: number;
	path: string;
	mediaType: ImageMediaType;
	direction: TelegramMediaDirection;
	createdAt: number;
}

interface TelegramMediaRefStoreOptions {
	journalMode?: "WAL" | "DELETE";
}

export class TelegramMediaRefStore {
	private db: Database;

	constructor(path: string, options: TelegramMediaRefStoreOptions = {}) {
		this.db = new Database(path, { create: true });
		this.db.exec(`PRAGMA journal_mode=${options.journalMode ?? "DELETE"}`);
		this.migrate();
	}

	private migrate() {
		this.db.exec(`CREATE TABLE IF NOT EXISTS telegram_media_refs (
			chat_id INTEGER NOT NULL,
			message_id INTEGER NOT NULL,
			path TEXT NOT NULL,
			media_type TEXT NOT NULL,
			direction TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (chat_id, message_id)
		)`);
	}

	upsert(params: {
		chatId: number;
		messageId: number;
		path: string;
		mediaType: ImageMediaType;
		direction: TelegramMediaDirection;
	}) {
		const now = Date.now();
		this.db
			.query(
				`INSERT INTO telegram_media_refs
					(chat_id, message_id, path, media_type, direction, created_at)
				VALUES ($chatId, $messageId, $path, $mediaType, $direction, $createdAt)
				ON CONFLICT(chat_id, message_id) DO UPDATE SET
					path = $path,
					media_type = $mediaType,
					direction = $direction`,
			)
			.run({
				$chatId: params.chatId,
				$messageId: params.messageId,
				$path: params.path,
				$mediaType: params.mediaType,
				$direction: params.direction,
				$createdAt: now,
			});
	}

	get(chatId: number, messageId: number): TelegramMediaRefRow | undefined {
		const row = this.db
			.query(
				`SELECT chat_id, message_id, path, media_type, direction, created_at
				FROM telegram_media_refs
				WHERE chat_id = $chatId AND message_id = $messageId`,
			)
			.get({
				$chatId: chatId,
				$messageId: messageId,
			}) as {
			chat_id: number;
			message_id: number;
			path: string;
			media_type: ImageMediaType;
			direction: TelegramMediaDirection;
			created_at: number;
		} | null;

		if (!row) return undefined;
		return {
			chatId: row.chat_id,
			messageId: row.message_id,
			path: row.path,
			mediaType: row.media_type,
			direction: row.direction,
			createdAt: row.created_at,
		};
	}

	close() {
		this.db.close();
	}
}
