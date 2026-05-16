import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CODING_STORAGE_OWNER_ID,
	CodingRepositoryStore,
	CodingSessionStore,
} from "../../../src/runtime/coding/index.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store/session-store.ts";

function createStores(storageOwnerId = CODING_STORAGE_OWNER_ID) {
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "outclaw-coding-sessions-")),
		"sessions.sqlite",
	);
	const sessions = new SessionStore(dbPath, {
		agentId: storageOwnerId,
		journalMode: "DELETE",
	});
	const codingSessions = new CodingSessionStore(dbPath, {
		journalMode: "DELETE",
		storageOwnerId,
	});
	const repositories = new CodingRepositoryStore(dbPath, {
		journalMode: "DELETE",
	});
	return { dbPath, sessions, codingSessions, repositories };
}

function insertCodingSession(
	sessions: SessionStore,
	codingSessions: CodingSessionStore,
	params: {
		id: string;
		title: string;
		timestamp: number;
		cwd?: string;
		linkedChatSessionId?: string;
		lifecycleStatus?: "open" | "archived";
		runStatus?: "idle" | "running" | "failed";
		repositoryId?: string;
	},
) {
	sessions.upsert({
		providerId: "codex",
		sdkSessionId: params.id,
		title: params.title,
		model: "gpt-5.5",
		source: "code",
		tag: "code",
		timestamp: params.timestamp,
	});
	codingSessions.upsert({
		providerId: "codex",
		sdkSessionId: params.id,
		cwd: params.cwd ?? "/workspace/outclaw",
		linkedChatSessionId: params.linkedChatSessionId,
		lifecycleStatus: params.lifecycleStatus,
		repositoryId: params.repositoryId,
		runStatus: params.runStatus ?? "running",
		timestamp: params.timestamp,
	});
}

describe("CodingSessionStore", () => {
	test("stores coding metadata beside a shared session row", () => {
		const { sessions, codingSessions } = createStores();

		sessions.upsert({
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
			title: "Fix tests",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 10,
		});
		codingSessions.upsert({
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
			cwd: "/workspace/outclaw",
			linkedChatSessionId: "chat-session-1",
			runStatus: "running",
			timestamp: 20,
		});

		expect(codingSessions.get("codex", "codex-thread-1")).toEqual({
			storageOwnerId: CODING_STORAGE_OWNER_ID,
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
			cwd: "/workspace/outclaw",
			linkedChatSessionId: "chat-session-1",
			lifecycleStatus: "open",
			cascadedFromRepo: false,
			runStatus: "running",
			createdAt: 20,
			lastActive: 20,
		});

		sessions.delete("codex", "codex-thread-1");

		expect(codingSessions.get("codex", "codex-thread-1")).toBeUndefined();

		codingSessions.close();
		sessions.close();
	});

	test("lists coding sessions with shared session metadata and cursor pagination", () => {
		const { dbPath, sessions, codingSessions } = createStores();
		const otherAgentSessions = new SessionStore(dbPath, {
			agentId: "other-coding-owner",
			journalMode: "DELETE",
		});
		const otherAgentCodingSessions = new CodingSessionStore(dbPath, {
			journalMode: "DELETE",
			storageOwnerId: "other-coding-owner",
		});

		insertCodingSession(sessions, codingSessions, {
			id: "codex-old",
			title: "Old code task",
			timestamp: 10,
			runStatus: "idle",
		});
		insertCodingSession(sessions, codingSessions, {
			id: "codex-new",
			title: "New code task",
			timestamp: 30,
		});
		sessions.upsert({
			providerId: "codex",
			sdkSessionId: "chat-with-code-provider",
			title: "Chat row",
			model: "gpt-5.5",
			source: "tui",
			tag: "chat",
			timestamp: 40,
		});
		insertCodingSession(otherAgentSessions, otherAgentCodingSessions, {
			id: "codex-other-agent",
			title: "Other agent code task",
			timestamp: 50,
		});

		const firstPage = codingSessions.list({
			providerId: "codex",
			limit: 1,
		});
		expect(firstPage.sessions).toEqual([
			{
				storageOwnerId: CODING_STORAGE_OWNER_ID,
				providerId: "codex",
				sdkSessionId: "codex-new",
				title: "New code task",
				model: "gpt-5.5",
				source: "code",
				tag: "code",
				cwd: "/workspace/outclaw",
				lifecycleStatus: "open",
				cascadedFromRepo: false,
				runStatus: "running",
				createdAt: 30,
				lastActive: 30,
			},
		]);
		expect(firstPage.nextCursor).toEqual({
			lastActive: 30,
			sdkSessionId: "codex-new",
		});

		expect(
			codingSessions.list({
				providerId: "codex",
				limit: 1,
				cursor: firstPage.nextCursor,
			}).sessions,
		).toMatchObject([
			{
				sdkSessionId: "codex-old",
				title: "Old code task",
				runStatus: "idle",
			},
		]);
		expect(codingSessions.getDetail("codex", "codex-new")).toMatchObject({
			sdkSessionId: "codex-new",
			title: "New code task",
			model: "gpt-5.5",
			cwd: "/workspace/outclaw",
		});

		otherAgentCodingSessions.close();
		otherAgentSessions.close();
		codingSessions.close();
		sessions.close();
	});

	test("filters coding sessions by linked chat session id", () => {
		const { sessions, codingSessions } = createStores();
		insertCodingSession(sessions, codingSessions, {
			id: "linked-code",
			title: "Linked code task",
			timestamp: 20,
			linkedChatSessionId: "chat-1",
		});
		insertCodingSession(sessions, codingSessions, {
			id: "other-code",
			title: "Other code task",
			timestamp: 30,
			linkedChatSessionId: "chat-2",
		});

		expect(
			codingSessions
				.list({
					providerId: "codex",
					linkedChatSessionId: "chat-1",
				})
				.sessions.map((session) => session.sdkSessionId),
		).toEqual(["linked-code"]);

		codingSessions.close();
		sessions.close();
	});

	test("links coding sessions to registered repositories", () => {
		const { sessions, codingSessions, repositories } = createStores();
		const repo = repositories.register({
			rootCwd: mkdtempSync(join(tmpdir(), "outclaw-code-repo-")),
			source: "manual",
			timestamp: 10,
		});
		insertCodingSession(sessions, codingSessions, {
			id: "repo-linked",
			title: "Repo linked task",
			timestamp: 20,
			repositoryId: repo.id,
		});
		insertCodingSession(sessions, codingSessions, {
			id: "unlinked",
			title: "Unlinked task",
			timestamp: 30,
		});

		expect(codingSessions.getDetail("codex", "repo-linked")).toMatchObject({
			repositoryId: repo.id,
			sdkSessionId: "repo-linked",
		});
		expect(
			codingSessions
				.list({ repositoryId: repo.id })
				.sessions.map((session) => session.sdkSessionId),
		).toEqual(["repo-linked"]);

		repositories.close();
		codingSessions.close();
		sessions.close();
	});

	test("resolves explicit and unambiguous bare coding session refs", () => {
		const { sessions, codingSessions } = createStores();
		insertCodingSession(sessions, codingSessions, {
			id: "codex-code",
			title: "Codex task",
			timestamp: 20,
		});
		sessions.upsert({
			providerId: "claude",
			sdkSessionId: "shared-id",
			title: "Claude code task",
			model: "opus",
			source: "code",
			tag: "code",
			timestamp: 30,
		});
		codingSessions.upsert({
			providerId: "claude",
			sdkSessionId: "shared-id",
			cwd: "/workspace/claude",
			runStatus: "idle",
			timestamp: 30,
		});
		sessions.upsert({
			providerId: "codex",
			sdkSessionId: "shared-id",
			title: "Codex code task",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 40,
		});
		codingSessions.upsert({
			providerId: "codex",
			sdkSessionId: "shared-id",
			cwd: "/workspace/codex",
			runStatus: "idle",
			timestamp: 40,
		});

		expect(
			codingSessions.resolveRef({
				providerId: "codex",
				sdkSessionId: "shared-id",
			}),
		).toMatchObject({
			status: "resolved",
			session: {
				providerId: "codex",
				sdkSessionId: "shared-id",
			},
		});
		expect(
			codingSessions.resolveRef({ sdkSessionId: "codex-code" }),
		).toMatchObject({
			status: "resolved",
			session: {
				providerId: "codex",
				sdkSessionId: "codex-code",
			},
		});
		expect(codingSessions.resolveRef({ sdkSessionId: "shared-id" })).toEqual({
			status: "ambiguous",
			matches: [
				{ providerId: "claude", sdkSessionId: "shared-id" },
				{ providerId: "codex", sdkSessionId: "shared-id" },
			],
		});
		expect(codingSessions.resolveRef({ sdkSessionId: "missing" })).toEqual({
			status: "not_found",
		});

		codingSessions.close();
		sessions.close();
	});

	test("updates coding run status, stores failure details, and deletes through the shared session row", () => {
		const { sessions, codingSessions } = createStores();
		insertCodingSession(sessions, codingSessions, {
			id: "code-status",
			title: "Status code task",
			timestamp: 10,
			runStatus: "idle",
		});

		codingSessions.markRunning({
			providerId: "codex",
			sdkSessionId: "code-status",
			timestamp: 20,
		});
		expect(codingSessions.get("codex", "code-status")).toMatchObject({
			lifecycleStatus: "open",
			runStatus: "running",
			lastActive: 20,
		});

		codingSessions.markCompleted({
			providerId: "codex",
			sdkSessionId: "code-status",
			timestamp: 30,
		});
		expect(codingSessions.get("codex", "code-status")).toMatchObject({
			lifecycleStatus: "open",
			runStatus: "idle",
			lastActive: 30,
		});

		codingSessions.markFailed({
			providerId: "codex",
			sdkSessionId: "code-status",
			message: "Codex turn failed",
			timestamp: 40,
		});
		expect(codingSessions.getDetail("codex", "code-status")).toMatchObject({
			lifecycleStatus: "open",
			runStatus: "failed",
			lastActive: 40,
			failedAt: 40,
			failureMessage: "Codex turn failed",
		});
		expect(sessions.get("codex", "code-status")).toMatchObject({
			failedAt: 40,
			failureMessage: "Codex turn failed",
		});

		codingSessions.markCancelled({
			providerId: "codex",
			sdkSessionId: "code-status",
			timestamp: 50,
		});
		expect(codingSessions.get("codex", "code-status")).toMatchObject({
			lifecycleStatus: "open",
			runStatus: "cancelled",
			lastActive: 50,
		});

		codingSessions.delete("codex", "code-status");

		expect(codingSessions.get("codex", "code-status")).toBeUndefined();
		expect(sessions.get("codex", "code-status")).toBeUndefined();

		codingSessions.close();
		sessions.close();
	});

	test("archives sessions out of the default list and restores them without rewriting last_active", () => {
		const { sessions, codingSessions, repositories } = createStores();
		const repo = repositories.register({
			rootCwd: mkdtempSync(join(tmpdir(), "outclaw-code-archive-repo-")),
			source: "manual",
			timestamp: 5,
		});
		insertCodingSession(sessions, codingSessions, {
			id: "code-open",
			title: "Open task",
			timestamp: 20,
			repositoryId: repo.id,
			runStatus: "idle",
		});
		insertCodingSession(sessions, codingSessions, {
			id: "code-archived",
			title: "Archived task",
			timestamp: 10,
			repositoryId: repo.id,
			runStatus: "idle",
		});

		codingSessions.archive("codex", "code-archived");

		expect(codingSessions.getDetail("codex", "code-archived")).toMatchObject({
			lifecycleStatus: "archived",
			lastActive: 10,
		});
		expect(
			codingSessions
				.list({ repositoryId: repo.id })
				.sessions.map((session) => session.sdkSessionId),
		).toEqual(["code-open"]);
		expect(
			codingSessions
				.list({
					repositoryId: repo.id,
					lifecycleStatus: "archived",
				})
				.sessions.map((session) => session.sdkSessionId),
		).toEqual(["code-archived"]);

		codingSessions.restore("codex", "code-archived");

		expect(codingSessions.getDetail("codex", "code-archived")).toMatchObject({
			lifecycleStatus: "open",
			lastActive: 10,
		});

		repositories.close();
		codingSessions.close();
		sessions.close();
	});

	test("trashes sessions and restores them without rewriting last_active", () => {
		const { sessions, codingSessions, repositories } = createStores();
		const repo = repositories.register({
			rootCwd: mkdtempSync(join(tmpdir(), "outclaw-code-trash-repo-")),
			source: "manual",
			timestamp: 5,
		});
		insertCodingSession(sessions, codingSessions, {
			id: "code-open",
			title: "Open task",
			timestamp: 20,
			repositoryId: repo.id,
			runStatus: "idle",
		});
		insertCodingSession(sessions, codingSessions, {
			id: "code-trashed",
			title: "Trashed task",
			timestamp: 10,
			repositoryId: repo.id,
			runStatus: "idle",
		});

		codingSessions.trash("codex", "code-trashed");

		expect(codingSessions.getDetail("codex", "code-trashed")).toMatchObject({
			lifecycleStatus: "trashed",
			lastActive: 10,
		});
		expect(
			codingSessions
				.list({ repositoryId: repo.id })
				.sessions.map((session) => session.sdkSessionId),
		).toEqual(["code-open"]);
		expect(
			codingSessions
				.list({ repositoryId: repo.id, lifecycleStatus: "archived" })
				.sessions.map((session) => session.sdkSessionId),
		).toEqual([]);
		expect(
			codingSessions
				.list({ repositoryId: repo.id, lifecycleStatus: "trashed" })
				.sessions.map((session) => session.sdkSessionId),
		).toEqual(["code-trashed"]);

		codingSessions.restore("codex", "code-trashed");
		expect(
			codingSessions
				.list({ repositoryId: repo.id })
				.sessions.map((session) => session.sdkSessionId),
		).toEqual(["code-open", "code-trashed"]);

		repositories.close();
		codingSessions.close();
		sessions.close();
	});

	test("cascades archive across a repository's open sessions and restores only those", () => {
		const { sessions, codingSessions, repositories } = createStores();
		const repo = repositories.register({
			rootCwd: mkdtempSync(join(tmpdir(), "outclaw-code-cascade-repo-")),
			source: "manual",
			timestamp: 5,
		});
		insertCodingSession(sessions, codingSessions, {
			id: "code-open-1",
			title: "Open one",
			timestamp: 30,
			repositoryId: repo.id,
			runStatus: "idle",
		});
		insertCodingSession(sessions, codingSessions, {
			id: "code-open-2",
			title: "Open two",
			timestamp: 20,
			repositoryId: repo.id,
			runStatus: "idle",
		});
		insertCodingSession(sessions, codingSessions, {
			id: "code-already-archived",
			title: "Already archived",
			timestamp: 10,
			repositoryId: repo.id,
			runStatus: "idle",
		});
		codingSessions.archive("codex", "code-already-archived");

		codingSessions.archiveCascaded(repo.id);

		const archivedIds = codingSessions
			.list({ repositoryId: repo.id, lifecycleStatus: "archived" })
			.sessions.map((session) => session.sdkSessionId);
		expect(archivedIds.sort()).toEqual(
			["code-already-archived", "code-open-1", "code-open-2"].sort(),
		);

		codingSessions.restoreCascaded(repo.id);

		const openIds = codingSessions
			.list({ repositoryId: repo.id })
			.sessions.map((session) => session.sdkSessionId)
			.sort();
		expect(openIds).toEqual(["code-open-1", "code-open-2"]);
		expect(
			codingSessions
				.list({ repositoryId: repo.id, lifecycleStatus: "archived" })
				.sessions.map((session) => session.sdkSessionId),
		).toEqual(["code-already-archived"]);

		repositories.close();
		codingSessions.close();
		sessions.close();
	});

	test("purges trashed sessions older than the given threshold", () => {
		const { sessions, codingSessions, repositories } = createStores();
		const repo = repositories.register({
			rootCwd: mkdtempSync(join(tmpdir(), "outclaw-code-purge-repo-")),
			source: "manual",
			timestamp: 5,
		});
		insertCodingSession(sessions, codingSessions, {
			id: "code-trashed-stale",
			title: "Trashed stale",
			timestamp: 10,
			repositoryId: repo.id,
			runStatus: "idle",
		});
		insertCodingSession(sessions, codingSessions, {
			id: "code-trashed-fresh",
			title: "Trashed fresh",
			timestamp: 200,
			repositoryId: repo.id,
			runStatus: "idle",
		});
		insertCodingSession(sessions, codingSessions, {
			id: "code-open",
			title: "Open task",
			timestamp: 50,
			repositoryId: repo.id,
			runStatus: "idle",
		});
		codingSessions.trash("codex", "code-trashed-stale", 50);
		codingSessions.trash("codex", "code-trashed-fresh", 200);

		const purged = codingSessions.purgeTrashedBefore(100);

		expect(purged).toBe(1);
		expect(codingSessions.get("codex", "code-trashed-stale")).toBeUndefined();
		expect(codingSessions.get("codex", "code-trashed-fresh")).toBeDefined();
		expect(codingSessions.get("codex", "code-open")).toBeDefined();

		repositories.close();
		codingSessions.close();
		sessions.close();
	});

	test("purges trashed sessions by trash time instead of last activity", () => {
		const { sessions, codingSessions, repositories } = createStores();
		const repo = repositories.register({
			rootCwd: mkdtempSync(join(tmpdir(), "outclaw-code-trash-time-repo-")),
			source: "manual",
			timestamp: 5,
		});
		insertCodingSession(sessions, codingSessions, {
			id: "code-old-but-newly-trashed",
			title: "Old but newly trashed",
			timestamp: 10,
			repositoryId: repo.id,
			runStatus: "idle",
		});
		codingSessions.trash("codex", "code-old-but-newly-trashed", 1_000);

		expect(codingSessions.purgeTrashedBefore(500)).toBe(0);
		expect(
			codingSessions.get("codex", "code-old-but-newly-trashed"),
		).toBeDefined();

		expect(codingSessions.purgeTrashedBefore(1_500)).toBe(1);
		expect(
			codingSessions.get("codex", "code-old-but-newly-trashed"),
		).toBeUndefined();

		repositories.close();
		codingSessions.close();
		sessions.close();
	});

	test("renames coding sessions through the shared session row", () => {
		const { sessions, codingSessions } = createStores();
		insertCodingSession(sessions, codingSessions, {
			id: "code-rename",
			title: "Original title",
			timestamp: 10,
		});

		codingSessions.rename("codex", "code-rename", "Renamed coding session");

		expect(codingSessions.getDetail("codex", "code-rename")).toMatchObject({
			title: "Renamed coding session",
		});
		expect(sessions.get("codex", "code-rename")).toMatchObject({
			title: "Renamed coding session",
		});

		codingSessions.close();
		sessions.close();
	});

	test("filters coding sessions by title-search tokens", () => {
		const { sessions, codingSessions } = createStores();
		insertCodingSession(sessions, codingSessions, {
			id: "code-auth",
			title: "Auth flow refactor",
			timestamp: 30,
		});
		insertCodingSession(sessions, codingSessions, {
			id: "code-billing",
			title: "Billing cleanup",
			timestamp: 20,
		});
		insertCodingSession(sessions, codingSessions, {
			id: "code-other",
			title: "Unrelated work",
			timestamp: 10,
		});

		const matches = codingSessions.list({ query: "auth" }).sessions;
		expect(matches.map((entry) => entry.sdkSessionId)).toEqual(["code-auth"]);

		const multi = codingSessions.list({ query: "auth flow" }).sessions;
		expect(multi.map((entry) => entry.sdkSessionId)).toEqual(["code-auth"]);

		const missing = codingSessions.list({ query: "nothing" }).sessions;
		expect(missing).toEqual([]);

		codingSessions.close();
		sessions.close();
	});
});
