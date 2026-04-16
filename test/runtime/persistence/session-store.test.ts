import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptTurn } from "../../../src/common/protocol.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store.ts";

const TEST_DB = join(import.meta.dir, ".tmp-test.sqlite");
const CLAUDE_PROVIDER = "claude";
const MOCK_PROVIDER = "mock";
const DEFAULT_AGENT_ID = "agent-default";
const RAILLY_AGENT_ID = "agent-railly";
const MIMI_AGENT_ID = "agent-mimi";

function createTestStore(
	options?: ConstructorParameters<typeof SessionStore>[1],
) {
	return new SessionStore(TEST_DB, options);
}

describe("SessionStore", () => {
	afterEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		if (existsSync(`${TEST_DB}-wal`)) rmSync(`${TEST_DB}-wal`);
		if (existsSync(`${TEST_DB}-shm`)) rmSync(`${TEST_DB}-shm`);
	});

	test("creates DB and tables on init", () => {
		const store = createTestStore();
		expect(existsSync(TEST_DB)).toBe(true);
		store.close();
	});

	test("upsert creates a new session", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-123",
			title: "Hello world",
			model: "sonnet",
		});

		const session = store.get(CLAUDE_PROVIDER, "sdk-123");
		expect(session).toBeDefined();
		expect(session?.agentId).toBe(DEFAULT_AGENT_ID);
		expect(session?.providerId).toBe(CLAUDE_PROVIDER);
		expect(session?.title).toBe("Hello world");
		expect(session?.model).toBe("sonnet");
		expect(session?.createdAt).toBeGreaterThan(0);

		store.close();
	});

	test("upsert persists source", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-tg",
			title: "From Telegram",
			model: "opus",
			source: "telegram",
		});

		const session = store.get(CLAUDE_PROVIDER, "sdk-tg");
		expect(session?.source).toBe("telegram");

		store.close();
	});

	test("source defaults to tui when not provided", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-tui",
			title: "From TUI",
			model: "opus",
		});

		const session = store.get(CLAUDE_PROVIDER, "sdk-tui");
		expect(session?.source).toBe("tui");

		store.close();
	});

	test("tag defaults to chat when not provided", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-chat",
			title: "Interactive chat",
			model: "opus",
		});

		expect(store.get(CLAUDE_PROVIDER, "sdk-chat")?.tag).toBe("chat");

		store.close();
	});

	test("upsert persists cron tags", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-cron",
			title: "daily-summary",
			model: "haiku",
			tag: "cron",
		});

		expect(store.get(CLAUDE_PROVIDER, "sdk-cron")?.tag).toBe("cron");

		store.close();
	});

	test("upsert overwrites source on update", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-123",
			title: "First",
			model: "sonnet",
			source: "telegram",
		});
		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-123",
			title: "Updated",
			model: "opus",
			source: "tui",
		});

		const session = store.get(CLAUDE_PROVIDER, "sdk-123");
		expect(session?.title).toBe("Updated");
		expect(session?.source).toBe("tui");

		store.close();
	});

	test("persists last user target", () => {
		let store = createTestStore();
		store.setLastUserTarget({
			kind: "telegram",
			chatId: 123,
		});
		store.close();

		store = createTestStore();
		expect(store.getLastUserTarget()).toEqual({
			kind: "telegram",
			chatId: 123,
		});

		store.close();
	});

	test("scopes sessions by the bound agent id", () => {
		const raillyStore = createTestStore({ agentId: RAILLY_AGENT_ID });
		const mimiStore = createTestStore({ agentId: MIMI_AGENT_ID });

		raillyStore.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "shared-id",
			title: "Railly chat",
			model: "opus",
		});
		mimiStore.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "shared-id",
			title: "Mimi chat",
			model: "haiku",
		});

		expect(raillyStore.get(CLAUDE_PROVIDER, "shared-id")).toMatchObject({
			agentId: RAILLY_AGENT_ID,
			title: "Railly chat",
		});
		expect(mimiStore.get(CLAUDE_PROVIDER, "shared-id")).toMatchObject({
			agentId: MIMI_AGENT_ID,
			title: "Mimi chat",
		});

		raillyStore.close();
		mimiStore.close();
	});

	test("upsert updates existing session", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-123",
			title: "First",
			model: "sonnet",
		});
		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-123",
			title: "Updated",
			model: "opus",
		});

		const session = store.get(CLAUDE_PROVIDER, "sdk-123");
		expect(session?.title).toBe("Updated");
		expect(session?.model).toBe("opus");

		store.close();
	});

	test("list returns sessions ordered by last_active desc", async () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "old",
			title: "Old",
			model: "haiku",
		});
		await new Promise((r) => setTimeout(r, 10));
		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "new",
			title: "New",
			model: "sonnet",
		});

		const sessions = store.list(20, undefined, CLAUDE_PROVIDER);
		expect(sessions.length).toBe(2);
		expect(sessions[0]?.sdkSessionId).toBe("new");

		store.close();
	});

	test("list filters by tag", async () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "chat-1",
			title: "Chat",
			model: "opus",
		});
		await new Promise((r) => setTimeout(r, 10));
		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "cron-1",
			title: "daily-summary",
			model: "haiku",
			tag: "cron",
		});

		const chatOnly = store.list(20, "chat", CLAUDE_PROVIDER);
		expect(chatOnly.length).toBe(1);
		expect(chatOnly[0]?.sdkSessionId).toBe("chat-1");

		const all = store.list(20, undefined, CLAUDE_PROVIDER);
		expect(all.length).toBe(2);

		store.close();
	});

	test("list reopens and retries once on SQLITE_IOERR", () => {
		const store = createTestStore();
		const originalDb = (store as unknown as { db: Database }).db;
		const originalDbFileKey = (store as unknown as { dbFileKey?: string })
			.dbFileKey;
		const ioError = Object.assign(new Error("disk I/O error"), {
			code: "SQLITE_IOERR_VNODE",
		});
		let reopenCount = 0;
		const expectedRows = [
			{
				provider_id: CLAUDE_PROVIDER,
				sdk_session_id: "sdk-123",
				title: "Recovered",
				model: "opus",
				source: "tui",
				tag: "chat",
				created_at: 1,
				last_active: 2,
			},
		];
		const failingDb = {
			query() {
				return {
					all() {
						throw ioError;
					},
				};
			},
		};
		const recoveredDb = {
			query() {
				return {
					all() {
						return expectedRows;
					},
				};
			},
		};

		(store as unknown as { db: unknown }).db = failingDb;
		(store as unknown as { reopenConnection: () => void }).reopenConnection =
			() => {
				reopenCount += 1;
				(store as unknown as { db: unknown }).db = recoveredDb;
			};

		try {
			expect(store.list(20, undefined, CLAUDE_PROVIDER)).toEqual([
				expect.objectContaining({
					providerId: CLAUDE_PROVIDER,
					sdkSessionId: "sdk-123",
					title: "Recovered",
					model: "opus",
				}),
			]);
			expect(reopenCount).toBe(1);
		} finally {
			(store as unknown as { db: Database }).db = originalDb;
			(store as unknown as { dbFileKey?: string }).dbFileKey =
				originalDbFileKey;
			store.close();
		}
	});

	test("findByPrefix can filter matches by tag", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "chat-1",
			title: "Chat",
			model: "opus",
			tag: "chat",
		});
		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "cron-1",
			title: "Daily summary",
			model: "haiku",
			tag: "cron",
		});

		expect(
			store.findByPrefix(CLAUDE_PROVIDER, "chat", "chat")?.sdkSessionId,
		).toBe("chat-1");
		expect(store.findByPrefix(CLAUDE_PROVIDER, "cron", "chat")).toBeUndefined();

		store.close();
	});

	test("list scopes sessions by provider", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "shared-id",
			title: "Claude chat",
			model: "opus",
		});
		store.upsert({
			providerId: MOCK_PROVIDER,
			sdkSessionId: "shared-id",
			title: "Mock chat",
			model: "haiku",
		});

		expect(store.list(20, undefined, CLAUDE_PROVIDER)).toHaveLength(1);
		expect(store.list(20, undefined, MOCK_PROVIDER)).toHaveLength(1);
		expect(store.get(CLAUDE_PROVIDER, "shared-id")?.title).toBe("Claude chat");
		expect(store.get(MOCK_PROVIDER, "shared-id")?.title).toBe("Mock chat");

		store.close();
	});

	test("delete removes a session", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-del",
			title: "To delete",
			model: "opus",
		});
		expect(store.get(CLAUDE_PROVIDER, "sdk-del")).toBeDefined();

		store.delete(CLAUDE_PROVIDER, "sdk-del");
		expect(store.get(CLAUDE_PROVIDER, "sdk-del")).toBeUndefined();
		expect(store.list(20, undefined, CLAUDE_PROVIDER).length).toBe(0);

		store.close();
	});

	test("replaceTranscript stores searchable turn snapshots without duplicates", () => {
		const store = createTestStore();
		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-search",
			title: "Searchable session",
			model: "opus",
		});

		const firstSnapshot: TranscriptTurn[] = [
			{
				role: "user",
				content: "set up webhook handler",
				timestamp: 100,
			},
			{
				role: "assistant",
				content: "use Stripe signing secret",
				timestamp: 200,
			},
		];
		store.replaceTranscript(CLAUDE_PROVIDER, "sdk-search", firstSnapshot);

		let db = new Database(TEST_DB, { readonly: true });
		expect(
			db
				.query(
					`SELECT turn_index, role, body_text, timestamp
					 FROM transcript_turns
					 WHERE agent_id = $agentId
					   AND provider_id = $providerId
					   AND sdk_session_id = $id
					 ORDER BY turn_index`,
				)
				.all({
					$agentId: DEFAULT_AGENT_ID,
					$providerId: CLAUDE_PROVIDER,
					$id: "sdk-search",
				}),
		).toEqual([
			{
				turn_index: 0,
				role: "user",
				body_text: "set up webhook handler",
				timestamp: 100,
			},
			{
				turn_index: 1,
				role: "assistant",
				body_text: "use Stripe signing secret",
				timestamp: 200,
			},
		]);
		db.close();

		store.replaceTranscript(CLAUDE_PROVIDER, "sdk-search", [
			{
				role: "assistant",
				content: "updated answer only",
				timestamp: 300,
			},
		]);

		db = new Database(TEST_DB, { readonly: true });
		expect(
			db
				.query(
					`SELECT turn_index, role, body_text, timestamp
					 FROM transcript_turns
					 WHERE agent_id = $agentId
					   AND provider_id = $providerId
					   AND sdk_session_id = $id
					 ORDER BY turn_index`,
				)
				.all({
					$agentId: DEFAULT_AGENT_ID,
					$providerId: CLAUDE_PROVIDER,
					$id: "sdk-search",
				}),
		).toEqual([
			{
				turn_index: 0,
				role: "assistant",
				body_text: "updated answer only",
				timestamp: 300,
			},
		]);
		db.close();
		store.close();
	});

	test("replaceTranscript filters operational heartbeat noise from the search index", () => {
		const store = createTestStore();
		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-heartbeat",
			title: "Heartbeat session",
			model: "opus",
		});

		store.replaceTranscript(CLAUDE_PROVIDER, "sdk-heartbeat", [
			{
				role: "user",
				content:
					"Read HEARTBEAT.md and follow its instructions. Only act on what the file currently says — do not repeat tasks from earlier heartbeats or infer tasks from conversation history. If the file is missing or nothing needs attention, reply only `HEARTBEAT_OK`, no explaination.",
				timestamp: 100,
			},
			{
				role: "assistant",
				content: "HEARTBEAT_OK",
				timestamp: 200,
			},
			{
				role: "assistant",
				content: "`HEARTBEAT_OK`",
				timestamp: 300,
			},
			{
				role: "assistant",
				content: "Updated daily memory with the heartbeat prompt revision.",
				timestamp: 400,
			},
			{
				role: "user",
				content: "the heartbeat prompt still needs a wording fix",
				timestamp: 500,
			},
		]);

		const db = new Database(TEST_DB, { readonly: true });
		expect(
			db
				.query(
					`SELECT turn_index, role, body_text, timestamp
					 FROM transcript_turns
					 WHERE agent_id = $agentId
					   AND provider_id = $providerId
					   AND sdk_session_id = $id
					 ORDER BY turn_index`,
				)
				.all({
					$agentId: DEFAULT_AGENT_ID,
					$providerId: CLAUDE_PROVIDER,
					$id: "sdk-heartbeat",
				}),
		).toEqual([
			{
				turn_index: 0,
				role: "assistant",
				body_text: "Updated daily memory with the heartbeat prompt revision.",
				timestamp: 400,
			},
			{
				turn_index: 1,
				role: "user",
				body_text: "the heartbeat prompt still needs a wording fix",
				timestamp: 500,
			},
		]);
		db.close();
		store.close();
	});

	test("delete cascades transcript snapshots for the removed session", () => {
		const store = createTestStore();
		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-search",
			title: "Searchable session",
			model: "opus",
		});
		store.replaceTranscript(CLAUDE_PROVIDER, "sdk-search", [
			{
				role: "user",
				content: "search me",
				timestamp: 100,
			},
		]);

		store.delete(CLAUDE_PROVIDER, "sdk-search");

		const db = new Database(TEST_DB, { readonly: true });
		expect(
			db
				.query(
					`SELECT COUNT(*) AS count
					 FROM transcript_turns
					 WHERE agent_id = $agentId
					   AND provider_id = $providerId
					   AND sdk_session_id = $id`,
				)
				.get({
					$agentId: DEFAULT_AGENT_ID,
					$providerId: CLAUDE_PROVIDER,
					$id: "sdk-search",
				}),
		).toEqual({ count: 0 });
		db.close();
		store.close();
	});

	test("rename updates session title", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-ren",
			title: "Old title",
			model: "opus",
		});

		store.rename(CLAUDE_PROVIDER, "sdk-ren", "New title");
		expect(store.get(CLAUDE_PROVIDER, "sdk-ren")?.title).toBe("New title");

		store.close();
	});

	test("getActiveSessionId / setActiveSessionId scopes by provider", () => {
		const store = createTestStore();

		expect(store.getActiveSessionId(CLAUDE_PROVIDER)).toBeUndefined();

		store.setActiveSessionId(CLAUDE_PROVIDER, "sdk-456");
		expect(store.getActiveSessionId(CLAUDE_PROVIDER)).toBe("sdk-456");

		store.setActiveSessionId(CLAUDE_PROVIDER, undefined);
		expect(store.getActiveSessionId(CLAUDE_PROVIDER)).toBeUndefined();

		store.close();
	});

	test("active session persists across instances per provider", () => {
		let store = createTestStore();
		store.setActiveSessionId(CLAUDE_PROVIDER, "sdk-789");
		store.setActiveSessionId(MOCK_PROVIDER, "sdk-999");
		store.close();

		store = createTestStore();
		expect(store.getActiveSessionId(CLAUDE_PROVIDER)).toBe("sdk-789");
		expect(store.getActiveSessionId(MOCK_PROVIDER)).toBe("sdk-999");
		store.close();
	});

	test("last user target is scoped by bound agent id", () => {
		const raillyStore = createTestStore({ agentId: RAILLY_AGENT_ID });
		const mimiStore = createTestStore({ agentId: MIMI_AGENT_ID });

		raillyStore.setLastUserTarget({
			kind: "telegram",
			chatId: 111,
		});
		mimiStore.setLastUserTarget({
			kind: "telegram",
			chatId: 222,
		});

		expect(raillyStore.getLastUserTarget()).toEqual({
			kind: "telegram",
			chatId: 111,
		});
		expect(mimiStore.getLastUserTarget()).toEqual({
			kind: "telegram",
			chatId: 222,
		});

		raillyStore.close();
		mimiStore.close();
	});

	test("persists last_tui_agent_id independently of the bound agent", () => {
		let store = createTestStore({ agentId: RAILLY_AGENT_ID });
		store.setLastTuiAgentId(MIMI_AGENT_ID);
		store.close();

		store = createTestStore({ agentId: RAILLY_AGENT_ID });
		expect(store.getLastTuiAgentId()).toBe(MIMI_AGENT_ID);
		store.close();
	});

	test("rejects pre-migration session tables", () => {
		const db = new Database(TEST_DB, { create: true });
		db.exec(`CREATE TABLE sessions (
			sdk_session_id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			model TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'tui',
			created_at INTEGER NOT NULL,
			last_active INTEGER NOT NULL
		)`);
		db.exec(`CREATE TABLE state (
			key TEXT PRIMARY KEY,
			value TEXT
		)`);
		db.exec(`INSERT INTO sessions
			(sdk_session_id, title, model, source, created_at, last_active)
			VALUES ('sdk-legacy', 'Legacy', 'opus', 'tui', 1, 1)`);
		db.exec(
			"INSERT INTO state (key, value) VALUES ('active_session_id', 'sdk-legacy')",
		);
		db.exec(
			"INSERT INTO state (key, value) VALUES ('last_telegram_chat_id', '123')",
		);
		db.close();

		expect(() => createTestStore()).toThrow(
			"Unsupported legacy session store schema",
		);
	});

	test("setUsage and getUsage persist usage per provider session", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-1",
			title: "Chat",
			model: "opus",
		});

		const usage = {
			inputTokens: 100,
			outputTokens: 200,
			cacheCreationTokens: 50,
			cacheReadTokens: 25,
			contextWindow: 200000,
			maxOutputTokens: 32000,
			contextTokens: 1234,
			percentage: 1,
		};
		store.setUsage(CLAUDE_PROVIDER, "sdk-1", usage);

		const restored = store.getUsage(CLAUDE_PROVIDER, "sdk-1");
		expect(restored).toEqual(usage);

		store.close();
	});

	test("getUsage returns undefined for missing session", () => {
		const store = createTestStore();
		expect(store.getUsage(CLAUDE_PROVIDER, "nonexistent")).toBeUndefined();
		store.close();
	});

	test("getUsage returns undefined when no usage saved", () => {
		const store = createTestStore();
		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-1",
			title: "Chat",
			model: "opus",
		});
		expect(store.getUsage(CLAUDE_PROVIDER, "sdk-1")).toBeUndefined();
		store.close();
	});

	test("uses WAL during operation and cleans up on close", () => {
		const store = createTestStore();

		store.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-123",
			title: "Hello world",
			model: "sonnet",
		});

		expect(existsSync(`${TEST_DB}-wal`)).toBe(true);
		expect(existsSync(`${TEST_DB}-shm`)).toBe(true);

		store.close();

		expect(existsSync(`${TEST_DB}-wal`)).toBe(false);
		expect(existsSync(`${TEST_DB}-shm`)).toBe(false);
	});

	test("closing one session store keeps sibling connection usable", () => {
		const primary = createTestStore();
		const sibling = createTestStore();

		primary.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-123",
			title: "Hello world",
			model: "sonnet",
		});

		primary.close();

		expect(sibling.get(CLAUDE_PROVIDER, "sdk-123")?.title).toBe("Hello world");

		sibling.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-456",
			title: "Still alive",
			model: "opus",
		});
		expect(sibling.get(CLAUDE_PROVIDER, "sdk-456")?.title).toBe("Still alive");

		sibling.close();

		expect(existsSync(`${TEST_DB}-wal`)).toBe(false);
		expect(existsSync(`${TEST_DB}-shm`)).toBe(false);
	});

	test("deleteAgentData removes agent-scoped sessions and state and clears last_tui_agent_id when matched", () => {
		const globalStore = createTestStore();
		const raillyStore = createTestStore({ agentId: RAILLY_AGENT_ID });
		const mimiStore = createTestStore({ agentId: MIMI_AGENT_ID });

		raillyStore.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-railly",
			title: "Railly chat",
			model: "opus",
		});
		mimiStore.upsert({
			providerId: CLAUDE_PROVIDER,
			sdkSessionId: "sdk-mimi",
			title: "Mimi chat",
			model: "haiku",
		});
		mimiStore.setActiveSessionId(CLAUDE_PROVIDER, "sdk-mimi");
		mimiStore.setLastUserTarget({
			kind: "telegram",
			chatId: 222,
		});
		globalStore.setLastTuiAgentId(MIMI_AGENT_ID);

		globalStore.deleteAgentData(MIMI_AGENT_ID);

		expect(raillyStore.get(CLAUDE_PROVIDER, "sdk-railly")).toBeDefined();
		expect(mimiStore.get(CLAUDE_PROVIDER, "sdk-mimi")).toBeUndefined();
		expect(mimiStore.getActiveSessionId(CLAUDE_PROVIDER)).toBeUndefined();
		expect(mimiStore.getLastUserTarget()).toBeUndefined();
		expect(globalStore.getLastTuiAgentId()).toBeUndefined();

		globalStore.close();
		raillyStore.close();
		mimiStore.close();
	});
});
