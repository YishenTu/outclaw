import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
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
});
