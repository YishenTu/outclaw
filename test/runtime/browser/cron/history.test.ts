import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptTurn } from "../../../../src/common/protocol.ts";
import { listCronRunsForJob } from "../../../../src/runtime/browser/cron/history.ts";
import { SessionStore } from "../../../../src/runtime/persistence/session-store/session-store.ts";

const TEST_DB = join(import.meta.dir, ".tmp-cron-history.sqlite");

interface SeedSessionParams {
	agentId: string;
	providerId: string;
	sdkSessionId: string;
	title: string;
	tag?: "chat" | "cron";
	lastActive: number;
	turns?: TranscriptTurn[];
}

function seedSession(params: SeedSessionParams) {
	const store = new SessionStore(TEST_DB, { agentId: params.agentId });
	store.upsert({
		providerId: params.providerId,
		sdkSessionId: params.sdkSessionId,
		title: params.title,
		model: "opus",
		tag: params.tag,
	});
	if (params.turns) {
		store.replaceTranscript(
			params.providerId,
			params.sdkSessionId,
			params.turns,
		);
	}
	store.close();

	const db = new Database(TEST_DB);
	db.query(
		`UPDATE sessions
		 SET created_at = $lastActive,
		     last_active = $lastActive
		 WHERE agent_id = $agentId
		   AND provider_id = $providerId
		   AND sdk_session_id = $id`,
	).run({
		$lastActive: params.lastActive,
		$agentId: params.agentId,
		$providerId: params.providerId,
		$id: params.sdkSessionId,
	});
	db.close();
}

function userTurn(content: string, timestamp: number): TranscriptTurn {
	return { role: "user", content, timestamp };
}

function assistantTurn(content: string, timestamp: number): TranscriptTurn {
	return { role: "assistant", content, timestamp };
}

describe("listCronRunsForJob", () => {
	afterEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		if (existsSync(`${TEST_DB}-wal`)) rmSync(`${TEST_DB}-wal`);
		if (existsSync(`${TEST_DB}-shm`)) rmSync(`${TEST_DB}-shm`);
	});

	test("returns runs for the given job ordered newest first with assistant text", async () => {
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "old-run",
			title: "daily-report",
			tag: "cron",
			lastActive: 100,
			turns: [
				userTurn("scheduled prompt", 100),
				assistantTurn("Old result", 101),
			],
		});
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "new-run",
			title: "daily-report",
			tag: "cron",
			lastActive: 200,
			turns: [
				userTurn("scheduled prompt", 200),
				assistantTurn("Hello", 201),
				assistantTurn("World", 202),
			],
		});

		const store = new SessionStore(TEST_DB, { agentId: "agent-railly" });
		const result = await listCronRunsForJob(store, "daily-report", {
			limit: 10,
			readTranscript: async (_providerId, sessionId) => {
				if (sessionId === "new-run") {
					return [
						userTurn("scheduled prompt", 200),
						assistantTurn("Hello", 201),
						assistantTurn("World", 202),
					];
				}
				return [
					userTurn("scheduled prompt", 100),
					assistantTurn("Old result", 101),
				];
			},
		});
		store.close();

		expect(result.entries).toEqual([
			{
				providerId: "claude",
				sessionId: "new-run",
				ranAt: 200,
				resultText: "Hello\nWorld",
			},
			{
				providerId: "claude",
				sessionId: "old-run",
				ranAt: 100,
				resultText: "Old result",
			},
		]);
		expect(result.hasMore).toBe(false);
	});

	test("ignores chat sessions and other jobs", async () => {
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "chat-run",
			title: "daily-report",
			tag: "chat",
			lastActive: 300,
			turns: [assistantTurn("not-a-cron-run", 301)],
		});
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "other-cron",
			title: "weekly-report",
			tag: "cron",
			lastActive: 250,
			turns: [assistantTurn("other job", 251)],
		});
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "match-run",
			title: "daily-report",
			tag: "cron",
			lastActive: 200,
			turns: [assistantTurn("match", 201)],
		});

		const store = new SessionStore(TEST_DB, { agentId: "agent-railly" });
		const result = await listCronRunsForJob(store, "daily-report", {
			limit: 10,
			readTranscript: async () => [assistantTurn("match", 201)],
		});
		store.close();

		expect(result.entries.map((entry) => entry.sessionId)).toEqual([
			"match-run",
		]);
	});

	test("scopes to the given agent", async () => {
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "railly-run",
			title: "daily-report",
			tag: "cron",
			lastActive: 200,
			turns: [assistantTurn("railly", 201)],
		});
		seedSession({
			agentId: "agent-mimi",
			providerId: "claude",
			sdkSessionId: "mimi-run",
			title: "daily-report",
			tag: "cron",
			lastActive: 200,
			turns: [assistantTurn("mimi", 201)],
		});

		const store = new SessionStore(TEST_DB, { agentId: "agent-railly" });
		const result = await listCronRunsForJob(store, "daily-report", {
			limit: 10,
			readTranscript: async () => [assistantTurn("railly", 201)],
		});
		store.close();

		expect(result.entries.map((entry) => entry.sessionId)).toEqual([
			"railly-run",
		]);
	});

	test("supports pagination via before cursor and reports hasMore", async () => {
		for (let index = 1; index <= 5; index++) {
			seedSession({
				agentId: "agent-railly",
				providerId: "claude",
				sdkSessionId: `run-${index}`,
				title: "daily-report",
				tag: "cron",
				lastActive: index * 100,
				turns: [assistantTurn(`run ${index}`, index * 100 + 1)],
			});
		}

		const store = new SessionStore(TEST_DB, { agentId: "agent-railly" });
		const firstPage = await listCronRunsForJob(store, "daily-report", {
			limit: 1,
		});
		expect(firstPage.entries.map((entry) => entry.sessionId)).toEqual([
			"run-5",
		]);
		expect(firstPage.hasMore).toBe(true);

		const secondPage = await listCronRunsForJob(store, "daily-report", {
			limit: 3,
			before: firstPage.entries.at(-1),
		});
		expect(secondPage.entries.map((entry) => entry.sessionId)).toEqual([
			"run-4",
			"run-3",
			"run-2",
		]);
		expect(secondPage.hasMore).toBe(true);

		const lastPage = await listCronRunsForJob(store, "daily-report", {
			limit: 3,
			before: secondPage.entries.at(-1),
		});
		expect(lastPage.entries.map((entry) => entry.sessionId)).toEqual(["run-1"]);
		expect(lastPage.hasMore).toBe(false);
		store.close();
	});

	test("returns empty result text when transcript has no assistant turns", async () => {
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "no-reply",
			title: "daily-report",
			tag: "cron",
			lastActive: 100,
			turns: [userTurn("scheduled prompt", 100)],
		});

		const store = new SessionStore(TEST_DB, { agentId: "agent-railly" });
		const result = await listCronRunsForJob(store, "daily-report", {
			limit: 10,
		});
		store.close();

		expect(result.entries).toEqual([
			{
				providerId: "claude",
				sessionId: "no-reply",
				ranAt: 100,
				resultText: "",
			},
		]);
	});

	test("hydrates result text from provider transcript without mutating the index", async () => {
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "missing-index",
			title: "daily-report",
			tag: "cron",
			lastActive: 100,
		});

		const store = new SessionStore(TEST_DB, { agentId: "agent-railly" });
		const result = await listCronRunsForJob(store, "daily-report", {
			limit: 10,
			readTranscript: async (providerId, sessionId) => {
				expect(providerId).toBe("claude");
				expect(sessionId).toBe("missing-index");
				return [
					userTurn("scheduled prompt", 100),
					assistantTurn("Hydrated result", 101),
				];
			},
		});

		expect(result.entries).toEqual([
			{
				providerId: "claude",
				sessionId: "missing-index",
				ranAt: 100,
				resultText: "Hydrated result",
			},
		]);
		expect(store.listCronRunsByTitle("daily-report", { limit: 1 })).toEqual([
			{
				providerId: "claude",
				sessionId: "missing-index",
				ranAt: 100,
				resultText: "",
			},
		]);
		store.close();
	});

	test("uses stored fallback text when provider transcript is unavailable", async () => {
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "failed-run",
			title: "daily-report",
			tag: "cron",
			lastActive: 100,
			turns: [assistantTurn("[error] agent exploded", 100)],
		});

		const store = new SessionStore(TEST_DB, { agentId: "agent-railly" });
		const result = await listCronRunsForJob(store, "daily-report", {
			limit: 10,
			readTranscript: async () => undefined,
		});
		store.close();

		expect(result.entries).toEqual([
			{
				providerId: "claude",
				sessionId: "failed-run",
				ranAt: 100,
				resultText: "[error] agent exploded",
			},
		]);
	});

	test("does not skip runs with the same timestamp", async () => {
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "run-a",
			title: "daily-report",
			tag: "cron",
			lastActive: 100,
			turns: [assistantTurn("a", 101)],
		});
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "run-b",
			title: "daily-report",
			tag: "cron",
			lastActive: 100,
			turns: [assistantTurn("b", 101)],
		});
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "run-c",
			title: "daily-report",
			tag: "cron",
			lastActive: 100,
			turns: [assistantTurn("c", 101)],
		});

		const store = new SessionStore(TEST_DB, { agentId: "agent-railly" });
		const firstPage = await listCronRunsForJob(store, "daily-report", {
			limit: 1,
		});
		const secondPage = await listCronRunsForJob(store, "daily-report", {
			limit: 2,
			before: firstPage.entries.at(-1),
		});
		store.close();

		expect([
			...firstPage.entries.map((entry) => entry.sessionId),
			...secondPage.entries.map((entry) => entry.sessionId),
		]).toEqual(["run-c", "run-b", "run-a"]);
		expect(secondPage.hasMore).toBe(false);
	});
});
