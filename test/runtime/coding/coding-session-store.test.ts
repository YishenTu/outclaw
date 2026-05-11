import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CodingRepositoryStore,
	CodingSessionStore,
} from "../../../src/runtime/coding/index.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store/session-store.ts";

function createStores(agentId = "agent-railly") {
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "outclaw-coding-sessions-")),
		"sessions.sqlite",
	);
	const sessions = new SessionStore(dbPath, {
		agentId,
		journalMode: "DELETE",
	});
	const codingSessions = new CodingSessionStore(dbPath, {
		agentId,
		journalMode: "DELETE",
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
		linkedChat?: {
			agentId: string;
			providerId: string;
			sessionId: string;
		};
		status?: "running" | "completed" | "failed";
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
		linkedChat: params.linkedChat,
		repositoryId: params.repositoryId,
		status: params.status ?? "running",
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
			linkedChat: {
				agentId: "agent-railly",
				providerId: "claude",
				sessionId: "chat-session-1",
			},
			status: "running",
			timestamp: 20,
		});

		expect(codingSessions.get("codex", "codex-thread-1")).toEqual({
			agentId: "agent-railly",
			providerId: "codex",
			sdkSessionId: "codex-thread-1",
			cwd: "/workspace/outclaw",
			linkedChat: {
				agentId: "agent-railly",
				providerId: "claude",
				sessionId: "chat-session-1",
			},
			status: "running",
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
			agentId: "agent-mimi",
			journalMode: "DELETE",
		});
		const otherAgentCodingSessions = new CodingSessionStore(dbPath, {
			agentId: "agent-mimi",
			journalMode: "DELETE",
		});

		insertCodingSession(sessions, codingSessions, {
			id: "codex-old",
			title: "Old code task",
			timestamp: 10,
			status: "completed",
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
				agentId: "agent-railly",
				providerId: "codex",
				sdkSessionId: "codex-new",
				title: "New code task",
				model: "gpt-5.5",
				source: "code",
				tag: "code",
				cwd: "/workspace/outclaw",
				status: "running",
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
				status: "completed",
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

	test("filters coding sessions by linked chat identity", () => {
		const { sessions, codingSessions } = createStores();
		const linkedChat = {
			agentId: "agent-railly",
			providerId: "claude",
			sessionId: "chat-1",
		};
		insertCodingSession(sessions, codingSessions, {
			id: "linked-code",
			title: "Linked code task",
			timestamp: 20,
			linkedChat,
		});
		insertCodingSession(sessions, codingSessions, {
			id: "other-code",
			title: "Other code task",
			timestamp: 30,
			linkedChat: {
				agentId: "agent-railly",
				providerId: "claude",
				sessionId: "chat-2",
			},
		});

		expect(
			codingSessions
				.list({
					providerId: "codex",
					linkedChat,
				})
				.sessions.map((session) => session.sdkSessionId),
		).toEqual(["linked-code"]);

		codingSessions.close();
		sessions.close();
	});

	test("links coding sessions to registered repositories", () => {
		const { sessions, codingSessions, repositories } = createStores();
		const repo = repositories.register({
			defaultAgentId: "agent-railly",
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

	test("updates coding status, stores failure details, and deletes through the shared session row", () => {
		const { sessions, codingSessions } = createStores();
		insertCodingSession(sessions, codingSessions, {
			id: "code-status",
			title: "Status code task",
			timestamp: 10,
			status: "completed",
		});

		codingSessions.markRunning({
			providerId: "codex",
			sdkSessionId: "code-status",
			timestamp: 20,
		});
		expect(codingSessions.get("codex", "code-status")).toMatchObject({
			status: "running",
			lastActive: 20,
		});

		codingSessions.markCompleted({
			providerId: "codex",
			sdkSessionId: "code-status",
			timestamp: 30,
		});
		expect(codingSessions.get("codex", "code-status")).toMatchObject({
			status: "completed",
			lastActive: 30,
		});

		codingSessions.markFailed({
			providerId: "codex",
			sdkSessionId: "code-status",
			message: "Codex turn failed",
			timestamp: 40,
		});
		expect(codingSessions.getDetail("codex", "code-status")).toMatchObject({
			status: "failed",
			lastActive: 40,
			failedAt: 40,
			failureMessage: "Codex turn failed",
		});
		expect(sessions.get("codex", "code-status")).toMatchObject({
			failedAt: 40,
			failureMessage: "Codex turn failed",
		});

		codingSessions.delete("codex", "code-status");

		expect(codingSessions.get("codex", "code-status")).toBeUndefined();
		expect(sessions.get("codex", "code-status")).toBeUndefined();

		codingSessions.close();
		sessions.close();
	});
});
