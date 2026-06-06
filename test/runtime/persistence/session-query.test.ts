import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptTurn } from "../../../src/common/protocol.ts";
import { SessionQuery } from "../../../src/runtime/persistence/session-query.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store/session-store.ts";

const TEST_DB = join(import.meta.dir, ".tmp-session-query.sqlite");

function seedSession(params: {
	agentId: string;
	providerId: string;
	sdkSessionId: string;
	title: string;
	serviceTier?: string;
	tag?: "chat" | "cron";
	createdAt: number;
	lastActive: number;
}) {
	const store = new SessionStore(TEST_DB, { agentId: params.agentId });
	store.upsert({
		providerId: params.providerId,
		sdkSessionId: params.sdkSessionId,
		title: params.title,
		model: "opus",
		serviceTier: params.serviceTier,
		tag: params.tag,
	});
	store.close();

	const db = new Database(TEST_DB);
	db.query(
		`UPDATE sessions
		 SET created_at = $createdAt,
		     last_active = $lastActive
		 WHERE agent_id = $agentId
		   AND provider_id = $providerId
		   AND sdk_session_id = $id`,
	).run({
		$createdAt: params.createdAt,
		$lastActive: params.lastActive,
		$agentId: params.agentId,
		$providerId: params.providerId,
		$id: params.sdkSessionId,
	});
	db.close();
}

function seedTranscript(params: {
	agentId: string;
	providerId: string;
	sdkSessionId: string;
	turns: TranscriptTurn[];
}) {
	const store = new SessionStore(TEST_DB, { agentId: params.agentId });
	store.replaceTranscript(params.providerId, params.sdkSessionId, params.turns);
	store.close();
}

describe("SessionQuery", () => {
	afterEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		if (existsSync(`${TEST_DB}-wal`)) rmSync(`${TEST_DB}-wal`);
		if (existsSync(`${TEST_DB}-shm`)) rmSync(`${TEST_DB}-shm`);
	});

	test("lists sessions across all agents ordered by last_active desc", () => {
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "railly-chat-123456",
			title: "Railly chat",
			createdAt: 100,
			lastActive: 300,
		});
		seedSession({
			agentId: "agent-mimi",
			providerId: "claude",
			sdkSessionId: "mimi-chat-123456",
			title: "Mimi chat",
			createdAt: 200,
			lastActive: 400,
		});
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "railly-cron-123456",
			title: "Railly cron",
			tag: "cron",
			createdAt: 50,
			lastActive: 500,
		});

		const query = new SessionQuery(TEST_DB);
		expect(query.list({ tag: "chat" }).map((row) => row.sdkSessionId)).toEqual([
			"mimi-chat-123456",
			"railly-chat-123456",
		]);
		expect(
			query
				.list({ tag: "chat", agentId: "agent-railly" })
				.map((row) => row.sdkSessionId),
		).toEqual(["railly-chat-123456"]);
		query.close();
	});

	test("returns persisted service tier in list and transcript search results", () => {
		seedSession({
			agentId: "agent-railly",
			providerId: "codex",
			sdkSessionId: "codex-priority",
			title: "Priority chat",
			serviceTier: "priority",
			createdAt: 100,
			lastActive: 300,
		});
		seedTranscript({
			agentId: "agent-railly",
			providerId: "codex",
			sdkSessionId: "codex-priority",
			turns: [
				{
					role: "assistant",
					content: "priority result",
					timestamp: 100,
				},
			],
		});

		const query = new SessionQuery(TEST_DB);
		expect(
			query.list({ tag: "chat", agentId: "agent-railly" })[0]?.serviceTier,
		).toBe("priority");
		expect(
			query.search({ query: "priority", tag: "chat" })[0]?.session.serviceTier,
		).toBe("priority");
		query.close();
	});

	test("lists the next page from a stable cursor", () => {
		for (const params of [
			{ sdkSessionId: "sdk-a", lastActive: 300 },
			{ sdkSessionId: "sdk-b", lastActive: 300 },
			{ sdkSessionId: "sdk-c", lastActive: 200 },
			{ sdkSessionId: "sdk-d", lastActive: 100 },
		]) {
			seedSession({
				agentId: "agent-railly",
				providerId: "claude",
				sdkSessionId: params.sdkSessionId,
				title: params.sdkSessionId,
				createdAt: params.lastActive,
				lastActive: params.lastActive,
			});
		}

		const query = new SessionQuery(TEST_DB);
		const firstPage = query.list({
			agentId: "agent-railly",
			limit: 2,
			tag: "chat",
		});
		expect(firstPage.map((row) => row.sdkSessionId)).toEqual([
			"sdk-a",
			"sdk-b",
		]);
		expect(
			query
				.list({
					agentId: "agent-railly",
					cursor: {
						lastActive: firstPage[1]?.lastActive ?? 0,
						sdkSessionId: firstPage[1]?.sdkSessionId ?? "",
					},
					limit: 2,
					tag: "chat",
				})
				.map((row) => row.sdkSessionId),
		).toEqual(["sdk-c", "sdk-d"]);
		query.close();
	});

	test("prefers exact full-id matches before prefix matches", () => {
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "abc123",
			title: "Exact",
			createdAt: 100,
			lastActive: 100,
		});
		seedSession({
			agentId: "agent-mimi",
			providerId: "claude",
			sdkSessionId: "abc123999",
			title: "Prefix",
			createdAt: 200,
			lastActive: 200,
		});

		const query = new SessionQuery(TEST_DB);
		const result = query.resolve({ selector: "abc123", tag: "chat" });
		expect(result.status).toBe("one");
		if (result.status === "one") {
			expect(result.match.sdkSessionId).toBe("abc123");
		}
		query.close();
	});

	test("returns ambiguous when multiple rows share the same prefix", () => {
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "shared-prefix-a",
			title: "A",
			createdAt: 100,
			lastActive: 100,
		});
		seedSession({
			agentId: "agent-mimi",
			providerId: "claude",
			sdkSessionId: "shared-prefix-b",
			title: "B",
			createdAt: 200,
			lastActive: 200,
		});

		const query = new SessionQuery(TEST_DB);
		const result = query.resolve({ selector: "shared-prefix", tag: "chat" });
		expect(result.status).toBe("many");
		if (result.status === "many") {
			expect(result.matches.map((row) => row.sdkSessionId)).toEqual([
				"shared-prefix-b",
				"shared-prefix-a",
			]);
		}
		query.close();
	});

	test("search returns matching turns grouped by session and ordered by last_active desc", () => {
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "railly-session-1",
			title: "Railly webhook",
			createdAt: 100,
			lastActive: 300,
		});
		seedTranscript({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "railly-session-1",
			turns: [
				{
					role: "user",
					content: "set up stripe webhook handler",
					timestamp: 100,
				},
				{
					role: "assistant",
					content: "stripe signing secret is required",
					timestamp: 200,
				},
			],
		});
		seedSession({
			agentId: "agent-mimi",
			providerId: "claude",
			sdkSessionId: "mimi-session-2",
			title: "Mimi webhook",
			createdAt: 150,
			lastActive: 400,
		});
		seedTranscript({
			agentId: "agent-mimi",
			providerId: "claude",
			sdkSessionId: "mimi-session-2",
			turns: [
				{
					role: "assistant",
					content: "webhook retry plan",
					timestamp: 150,
				},
			],
		});
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "cron-session-1",
			title: "Cron webhook",
			tag: "cron",
			createdAt: 200,
			lastActive: 500,
		});
		seedTranscript({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "cron-session-1",
			turns: [
				{
					role: "assistant",
					content: "webhook cron output",
					timestamp: 250,
				},
			],
		});

		const query = new SessionQuery(TEST_DB);
		expect(
			query.search({ query: "webhook", tag: "chat" }).map((match) => ({
				id: match.session.sdkSessionId,
				turns: match.turns.map((turn) => turn.bodyText),
			})),
		).toEqual([
			{
				id: "mimi-session-2",
				turns: ["webhook retry plan"],
			},
			{
				id: "railly-session-1",
				turns: ["set up stripe webhook handler"],
			},
		]);
		expect(
			query
				.search({ query: "webhook stripe", tag: "chat" })
				.map((match) => match.session.sdkSessionId),
		).toEqual(["railly-session-1"]);
		expect(
			query
				.search({
					query: "webhook",
					tag: "chat",
					agentId: "agent-railly",
				})
				.map((match) => match.session.sdkSessionId),
		).toEqual(["railly-session-1"]);
		query.close();
	});

	test("searchByTitle matches lowercase AND tokens within one agent", () => {
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "sdk-auth",
			title: "Refactor auth middleware",
			createdAt: 100,
			lastActive: 300,
		});
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "sdk-auth-only",
			title: "Auth handlers",
			createdAt: 100,
			lastActive: 200,
		});
		seedSession({
			agentId: "agent-mimi",
			providerId: "claude",
			sdkSessionId: "sdk-other-agent",
			title: "Refactor auth middleware",
			createdAt: 100,
			lastActive: 400,
		});

		const query = new SessionQuery(TEST_DB);
		expect(
			query
				.searchByTitle({
					agentId: "agent-railly",
					query: "auth middle",
					tag: "chat",
				})
				.map((row) => row.sdkSessionId),
		).toEqual(["sdk-auth"]);
		expect(
			query
				.searchByTitle({
					agentId: "agent-railly",
					query: "auth foo",
					tag: "chat",
				})
				.map((row) => row.sdkSessionId),
		).toEqual([]);
		expect(query.searchByTitle({ query: "   ", tag: "chat" })).toEqual([]);
		query.close();
	});

	test("searchByTitle case-folds non-ASCII title tokens", () => {
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "sdk-munich",
			title: "MÜNCHEN Überprüfung",
			createdAt: 100,
			lastActive: 200,
		});

		const query = new SessionQuery(TEST_DB);
		expect(
			query
				.searchByTitle({
					agentId: "agent-railly",
					query: "münchen überprüfung",
					tag: "chat",
				})
				.map((row) => row.sdkSessionId),
		).toEqual(["sdk-munich"]);
		query.close();
	});

	test("searchByTitle paginates title matches with the same cursor semantics", () => {
		for (const params of [
			{ sdkSessionId: "sdk-a", lastActive: 300 },
			{ sdkSessionId: "sdk-b", lastActive: 300 },
			{ sdkSessionId: "sdk-c", lastActive: 200 },
		]) {
			seedSession({
				agentId: "agent-railly",
				providerId: "claude",
				sdkSessionId: params.sdkSessionId,
				title: `Auth ${params.sdkSessionId}`,
				createdAt: params.lastActive,
				lastActive: params.lastActive,
			});
		}

		const query = new SessionQuery(TEST_DB);
		const firstPage = query.searchByTitle({
			agentId: "agent-railly",
			limit: 2,
			query: "auth",
			tag: "chat",
		});
		expect(firstPage.map((row) => row.sdkSessionId)).toEqual([
			"sdk-a",
			"sdk-b",
		]);
		expect(
			query
				.searchByTitle({
					agentId: "agent-railly",
					cursor: {
						lastActive: firstPage[1]?.lastActive ?? 0,
						sdkSessionId: firstPage[1]?.sdkSessionId ?? "",
					},
					limit: 2,
					query: "auth",
					tag: "chat",
				})
				.map((row) => row.sdkSessionId),
		).toEqual(["sdk-c"]);
		query.close();
	});

	test("search has no default limit when limit is omitted", () => {
		for (let index = 0; index < 60; index += 1) {
			const sdkSessionId = `session-${String(index).padStart(2, "0")}`;
			seedSession({
				agentId: "agent-railly",
				providerId: "claude",
				sdkSessionId,
				title: `Session ${index}`,
				createdAt: 100 + index,
				lastActive: 1_000 + index,
			});
			seedTranscript({
				agentId: "agent-railly",
				providerId: "claude",
				sdkSessionId,
				turns: [
					{
						role: "user",
						content: `webhook search result ${index}`,
						timestamp: 10_000 + index,
					},
				],
			});
		}

		const query = new SessionQuery(TEST_DB);
		const matches = query.search({ query: "webhook", tag: "chat" });
		expect(matches).toHaveLength(60);
		expect(matches[0]?.session.sdkSessionId).toBe("session-59");
		expect(matches[59]?.session.sdkSessionId).toBe("session-00");
		query.close();
	});

	test("search paginates matching sessions with the shared cursor semantics", () => {
		for (const params of [
			{ sdkSessionId: "session-a", lastActive: 300 },
			{ sdkSessionId: "session-b", lastActive: 300 },
			{ sdkSessionId: "session-c", lastActive: 200 },
		]) {
			seedSession({
				agentId: "agent-railly",
				providerId: "claude",
				sdkSessionId: params.sdkSessionId,
				title: params.sdkSessionId,
				createdAt: params.lastActive,
				lastActive: params.lastActive,
			});
			seedTranscript({
				agentId: "agent-railly",
				providerId: "claude",
				sdkSessionId: params.sdkSessionId,
				turns: [
					{
						role: "user",
						content: `deploy ${params.sdkSessionId}`,
						timestamp: params.lastActive,
					},
				],
			});
		}

		const query = new SessionQuery(TEST_DB);
		const firstPage = query.search({
			agentId: "agent-railly",
			limit: 2,
			query: "deploy",
			tag: "chat",
		});
		expect(firstPage.map((match) => match.session.sdkSessionId)).toEqual([
			"session-a",
			"session-b",
		]);
		expect(
			query
				.search({
					agentId: "agent-railly",
					cursor: {
						lastActive: firstPage[1]?.session.lastActive ?? 0,
						sdkSessionId: firstPage[1]?.session.sdkSessionId ?? "",
					},
					limit: 2,
					query: "deploy",
					tag: "chat",
				})
				.map((match) => match.session.sdkSessionId),
		).toEqual(["session-c"]);
		query.close();
	});

	test("search ignores sessions that only contain heartbeat transport noise", () => {
		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "heartbeat-noise",
			title: "Heartbeat noise",
			createdAt: 100,
			lastActive: 300,
		});
		seedTranscript({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "heartbeat-noise",
			turns: [
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
			],
		});

		seedSession({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "heartbeat-signal",
			title: "Heartbeat fix discussion",
			createdAt: 150,
			lastActive: 400,
		});
		seedTranscript({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "heartbeat-signal",
			turns: [
				{
					role: "user",
					content: "the heartbeat prompt still needs a wording fix",
					timestamp: 150,
				},
			],
		});

		const query = new SessionQuery(TEST_DB);
		expect(
			query.search({ query: "heartbeat", tag: "chat" }).map((match) => ({
				id: match.session.sdkSessionId,
				turns: match.turns.map((turn) => turn.bodyText),
			})),
		).toEqual([
			{
				id: "heartbeat-signal",
				turns: ["the heartbeat prompt still needs a wording fix"],
			},
		]);
		query.close();
	});
});
