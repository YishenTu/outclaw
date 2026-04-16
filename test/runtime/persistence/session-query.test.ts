import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptTurn } from "../../../src/common/protocol.ts";
import { SessionQuery } from "../../../src/runtime/persistence/session-query.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store.ts";

const TEST_DB = join(import.meta.dir, ".tmp-session-query.sqlite");

function seedSession(params: {
	agentId: string;
	providerId: string;
	sdkSessionId: string;
	title: string;
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
