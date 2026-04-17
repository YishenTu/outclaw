import type { Database } from "bun:sqlite";
import type { ImageMediaType } from "../../common/protocol.ts";
import {
	closeSqliteDatabase,
	openSqliteDatabase,
} from "./sqlite-file-lifecycle.ts";

export type TelegramFileDirection = "inbound" | "outbound";

export type TelegramStoredFile =
	| {
			kind: "image";
			image: {
				path: string;
				mediaType: ImageMediaType;
			};
	  }
	| {
			kind: "document";
			document: {
				path: string;
				displayName: string;
			};
	  }
	| {
			kind: "voice";
			voice: {
				path: string;
				mimeType?: string;
				durationSeconds?: number;
			};
	  };

export interface TelegramFileRefRow {
	botId: string;
	chatId: number;
	messageId: number;
	path: string;
	kind: "image" | "document" | "voice";
	mediaType?: ImageMediaType | string;
	displayName?: string;
	durationSeconds?: number;
	direction: TelegramFileDirection;
	createdAt: number;
}

interface TelegramFileRefStoreOptions {
	botId?: string;
	journalMode?: "WAL" | "DELETE";
}

interface TelegramFileRefDbRow {
	bot_id: string;
	chat_id: number;
	message_id: number;
	path: string;
	kind: "image" | "document" | "voice";
	media_type: string;
	display_name: string | null;
	duration_seconds: number | null;
	direction: TelegramFileDirection;
	created_at: number;
}

const TELEGRAM_FILE_REFS_TABLE = "telegram_file_refs";
const DEFAULT_BOT_ID = "bot-default";

export class TelegramFileRefStore {
	private db: Database;
	private dbFileKey: string | undefined;
	private readonly botId: string;

	constructor(path: string, options: TelegramFileRefStoreOptions = {}) {
		this.botId = options.botId ?? DEFAULT_BOT_ID;
		const sqlite = openSqliteDatabase(path, options.journalMode ?? "WAL");
		this.db = sqlite.db;
		this.dbFileKey = sqlite.fileKey;
		try {
			this.ensureSchema();
		} catch (error) {
			closeSqliteDatabase(this.db, this.dbFileKey);
			throw error;
		}
	}

	private ensureSchema() {
		if (this.hasTable("telegram_media_refs")) {
			throw new Error("Unsupported legacy telegram file-ref schema");
		}

		if (!this.hasTable(TELEGRAM_FILE_REFS_TABLE)) {
			this.createCurrentTable(TELEGRAM_FILE_REFS_TABLE);
			return;
		}

		const columns = new Set(this.getColumnNames(TELEGRAM_FILE_REFS_TABLE));
		for (const columnName of [
			"bot_id",
			"chat_id",
			"message_id",
			"path",
			"kind",
			"media_type",
			"display_name",
			"direction",
			"created_at",
		]) {
			if (!columns.has(columnName)) {
				throw new Error("Unsupported legacy telegram file-ref schema");
			}
		}

		if (!columns.has("duration_seconds")) {
			this.db.exec(
				`ALTER TABLE ${TELEGRAM_FILE_REFS_TABLE} ADD COLUMN duration_seconds INTEGER`,
			);
		}
	}

	private hasTable(name: string): boolean {
		const row = this.db
			.query(
				"SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name",
			)
			.get({ $name: name });
		return row !== null;
	}

	private getColumnNames(tableName: string): string[] {
		const columns = this.db
			.query(`PRAGMA table_info(${tableName})`)
			.all() as Array<{ name: string }>;
		return columns.map((column) => column.name);
	}

	private createCurrentTable(tableName: string) {
		this.db.exec(`CREATE TABLE ${tableName} (
			bot_id TEXT NOT NULL,
			chat_id INTEGER NOT NULL,
			message_id INTEGER NOT NULL,
			path TEXT NOT NULL,
			kind TEXT NOT NULL,
			media_type TEXT NOT NULL DEFAULT '',
			display_name TEXT,
			duration_seconds INTEGER,
			direction TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (bot_id, chat_id, message_id)
		)`);
	}

	upsert(params: {
		chatId: number;
		messageId: number;
		path: string;
		file: TelegramStoredFile;
		direction: TelegramFileDirection;
	}) {
		const now = Date.now();
		const metadata = serializeFileMetadata(params.file);
		this.db
			.query(
				`INSERT INTO telegram_file_refs
					(bot_id, chat_id, message_id, path, kind, media_type, display_name, duration_seconds, direction, created_at)
				VALUES (
					$botId,
					$chatId,
					$messageId,
					$path,
					$kind,
					$mediaType,
					$displayName,
					$durationSeconds,
					$direction,
					$createdAt
				)
				ON CONFLICT(bot_id, chat_id, message_id) DO UPDATE SET
					path = $path,
					kind = $kind,
					media_type = $mediaType,
					display_name = $displayName,
					duration_seconds = $durationSeconds,
					direction = $direction`,
			)
			.run({
				$botId: this.botId,
				$chatId: params.chatId,
				$messageId: params.messageId,
				$path: params.path,
				$kind: metadata.kind,
				$mediaType: metadata.mediaType,
				$displayName: metadata.displayName,
				$durationSeconds: metadata.durationSeconds,
				$direction: params.direction,
				$createdAt: now,
			});
	}

	get(chatId: number, messageId: number): TelegramFileRefRow | undefined {
		const row = this.db
			.query(
				`SELECT
					bot_id,
					chat_id,
					message_id,
					path,
					kind,
					media_type,
					display_name,
					duration_seconds,
					direction,
					created_at
				FROM telegram_file_refs
				WHERE bot_id = $botId
				  AND chat_id = $chatId
				  AND message_id = $messageId`,
			)
			.get({
				$botId: this.botId,
				$chatId: chatId,
				$messageId: messageId,
			}) as TelegramFileRefDbRow | null;

		if (!row) {
			return undefined;
		}

		return {
			botId: row.bot_id,
			chatId: row.chat_id,
			messageId: row.message_id,
			path: row.path,
			kind: row.kind,
			mediaType: row.media_type ? row.media_type : undefined,
			displayName: row.display_name ?? undefined,
			durationSeconds: row.duration_seconds ?? undefined,
			direction: row.direction,
			createdAt: row.created_at,
		};
	}

	close() {
		closeSqliteDatabase(this.db, this.dbFileKey);
	}
}

function serializeFileMetadata(file: TelegramStoredFile): {
	kind: "image" | "document" | "voice";
	mediaType: string;
	displayName: string | null;
	durationSeconds: number | null;
} {
	if (file.kind === "image") {
		return {
			kind: "image",
			mediaType: file.image.mediaType,
			displayName: null,
			durationSeconds: null,
		};
	}

	if (file.kind === "voice") {
		return {
			kind: "voice",
			mediaType: file.voice.mimeType ?? "",
			displayName: null,
			durationSeconds: file.voice.durationSeconds ?? null,
		};
	}

	return {
		kind: "document",
		mediaType: "",
		displayName: file.document.displayName,
		durationSeconds: null,
	};
}
