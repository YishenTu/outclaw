import { Database } from "bun:sqlite";
import { resolve, sep } from "node:path";
import type { ImageMediaType } from "../../common/protocol.ts";

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
	  };

export interface TelegramFileRefRow {
	chatId: number;
	messageId: number;
	path: string;
	kind: "image" | "document";
	mediaType?: ImageMediaType;
	displayName?: string;
	direction: TelegramFileDirection;
	createdAt: number;
}

interface TelegramFileRefStoreOptions {
	journalMode?: "WAL" | "DELETE";
}

interface TelegramFileRefDbRow {
	chat_id: number;
	message_id: number;
	path: string;
	kind: "image" | "document";
	media_type: string;
	display_name: string | null;
	direction: TelegramFileDirection;
	created_at: number;
}

const TELEGRAM_FILE_REFS_TABLE = "telegram_file_refs";
const TELEGRAM_FILE_REFS_MIGRATION_TABLE = "telegram_file_refs_migrated";

export class TelegramFileRefStore {
	private db: Database;

	constructor(path: string, options: TelegramFileRefStoreOptions = {}) {
		this.db = new Database(path, { create: true });
		this.db.exec(`PRAGMA journal_mode=${options.journalMode ?? "DELETE"}`);
		this.migrate();
	}

	private migrate() {
		this.renameOldTable();
		if (!this.hasTable(TELEGRAM_FILE_REFS_TABLE)) {
			this.createCurrentTable(TELEGRAM_FILE_REFS_TABLE);
			return;
		}

		const columns = this.getColumnNames(TELEGRAM_FILE_REFS_TABLE);
		if (columns.includes("kind") && columns.includes("display_name")) {
			return;
		}

		this.rebuildTable(columns);
	}

	private renameOldTable() {
		if (
			this.hasTable("telegram_media_refs") &&
			!this.hasTable(TELEGRAM_FILE_REFS_TABLE)
		) {
			this.db.exec(
				"ALTER TABLE telegram_media_refs RENAME TO telegram_file_refs",
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
			.all() as Array<{
			name: string;
		}>;
		return columns.map((column) => column.name);
	}

	private createCurrentTable(tableName: string) {
		this.db.exec(`CREATE TABLE ${tableName} (
			chat_id INTEGER NOT NULL,
			message_id INTEGER NOT NULL,
			path TEXT NOT NULL,
			kind TEXT NOT NULL,
			media_type TEXT NOT NULL DEFAULT '',
			display_name TEXT,
			direction TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (chat_id, message_id)
		)`);
	}

	private rebuildTable(columns: string[]) {
		this.createCurrentTable(TELEGRAM_FILE_REFS_MIGRATION_TABLE);
		const displayNameExpression = columns.includes("display_name")
			? "display_name"
			: "NULL";
		const kindExpression = columns.includes("kind") ? "kind" : "'image'";
		this.db.exec(`INSERT INTO ${TELEGRAM_FILE_REFS_MIGRATION_TABLE} (
			chat_id,
			message_id,
			path,
			kind,
			media_type,
			display_name,
			direction,
			created_at
		)
		SELECT
			chat_id,
			message_id,
			path,
			${kindExpression},
			media_type,
			${displayNameExpression},
			direction,
			created_at
		FROM ${TELEGRAM_FILE_REFS_TABLE}`);
		this.db.exec(`DROP TABLE ${TELEGRAM_FILE_REFS_TABLE}`);
		this.db.exec(
			`ALTER TABLE ${TELEGRAM_FILE_REFS_MIGRATION_TABLE} RENAME TO ${TELEGRAM_FILE_REFS_TABLE}`,
		);
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
					(chat_id, message_id, path, kind, media_type, display_name, direction, created_at)
				VALUES (
					$chatId,
					$messageId,
					$path,
					$kind,
					$mediaType,
					$displayName,
					$direction,
					$createdAt
				)
				ON CONFLICT(chat_id, message_id) DO UPDATE SET
					path = $path,
					kind = $kind,
					media_type = $mediaType,
					display_name = $displayName,
					direction = $direction`,
			)
			.run({
				$chatId: params.chatId,
				$messageId: params.messageId,
				$path: params.path,
				$kind: metadata.kind,
				$mediaType: metadata.mediaType,
				$displayName: metadata.displayName,
				$direction: params.direction,
				$createdAt: now,
			});
	}

	get(chatId: number, messageId: number): TelegramFileRefRow | undefined {
		const row = this.db
			.query(
				`SELECT
					chat_id,
					message_id,
					path,
					kind,
					media_type,
					display_name,
					direction,
					created_at
				FROM telegram_file_refs
				WHERE chat_id = $chatId AND message_id = $messageId`,
			)
			.get({
				$chatId: chatId,
				$messageId: messageId,
			}) as TelegramFileRefDbRow | null;

		if (!row) {
			return undefined;
		}

		return {
			chatId: row.chat_id,
			messageId: row.message_id,
			path: row.path,
			kind: row.kind,
			mediaType: row.media_type
				? (row.media_type as ImageMediaType)
				: undefined,
			displayName: row.display_name ?? undefined,
			direction: row.direction,
			createdAt: row.created_at,
		};
	}

	rewriteRoot(previousRoot: string, nextRoot: string) {
		const resolvedPreviousRoot = resolve(previousRoot);
		const resolvedNextRoot = resolve(nextRoot);
		if (resolvedPreviousRoot === resolvedNextRoot) {
			return;
		}

		const rows = this.db
			.query(
				`SELECT chat_id, message_id, path
				FROM telegram_file_refs`,
			)
			.all() as Array<{
			chat_id: number;
			message_id: number;
			path: string;
		}>;

		const update = this.db.query(
			`UPDATE telegram_file_refs
			SET path = $path
			WHERE chat_id = $chatId AND message_id = $messageId`,
		);

		for (const row of rows) {
			if (!isPathWithinRoot(resolvedPreviousRoot, row.path)) {
				continue;
			}

			update.run({
				$path: `${resolvedNextRoot}${row.path.slice(resolvedPreviousRoot.length)}`,
				$chatId: row.chat_id,
				$messageId: row.message_id,
			});
		}
	}

	close() {
		this.db.close();
	}
}

function serializeFileMetadata(file: TelegramStoredFile): {
	kind: "image" | "document";
	mediaType: string;
	displayName: string | null;
} {
	if (file.kind === "image") {
		return {
			kind: "image",
			mediaType: file.image.mediaType,
			displayName: null,
		};
	}

	return {
		kind: "document",
		mediaType: "",
		displayName: file.document.displayName,
	};
}

function isPathWithinRoot(root: string, path: string): boolean {
	return path === root || path.startsWith(`${root}${sep}`);
}
