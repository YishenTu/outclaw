import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ChatCodingLinkStore,
	CODING_STORAGE_OWNER_ID,
	CodingSessionStore,
} from "../../../src/runtime/coding/index.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store/session-store.ts";

function createStores() {
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "outclaw-chat-coding-links-")),
		"sessions.sqlite",
	);
	const chatSessions = new SessionStore(dbPath, {
		agentId: "agent-railly",
		journalMode: "DELETE",
	});
	const codingSharedSessions = new SessionStore(dbPath, {
		agentId: CODING_STORAGE_OWNER_ID,
		journalMode: "DELETE",
	});
	const codingSessions = new CodingSessionStore(dbPath, {
		journalMode: "DELETE",
	});
	const links = new ChatCodingLinkStore(dbPath, {
		journalMode: "DELETE",
	});
	return { chatSessions, codingSharedSessions, codingSessions, links };
}

function insertChatSession(chatSessions: SessionStore) {
	chatSessions.upsert({
		providerId: "claude",
		sdkSessionId: "chat-1",
		title: "Build the idea",
		model: "opus",
		tag: "chat",
		timestamp: 10,
	});
}

function insertCodingSession(
	codingSharedSessions: SessionStore,
	codingSessions: CodingSessionStore,
	params: {
		sdkSessionId: string;
		title: string;
		timestamp: number;
	},
) {
	codingSharedSessions.upsert({
		providerId: "codex",
		sdkSessionId: params.sdkSessionId,
		title: params.title,
		model: "gpt-5.5",
		source: "code",
		tag: "code",
		timestamp: params.timestamp,
	});
	codingSessions.upsert({
		providerId: "codex",
		sdkSessionId: params.sdkSessionId,
		cwd: "/workspace/outclaw",
		runStatus: "idle",
		timestamp: params.timestamp,
	});
}

describe("ChatCodingLinkStore", () => {
	test("links a chat session to coding sessions and lists by latest link time", () => {
		const { chatSessions, codingSharedSessions, codingSessions, links } =
			createStores();
		insertChatSession(chatSessions);
		insertCodingSession(codingSharedSessions, codingSessions, {
			sdkSessionId: "code-old",
			title: "Old coding task",
			timestamp: 20,
		});
		insertCodingSession(codingSharedSessions, codingSessions, {
			sdkSessionId: "code-new",
			title: "New coding task",
			timestamp: 30,
		});

		links.upsert({
			chatAgentId: "agent-railly",
			chatProviderId: "claude",
			chatSdkSessionId: "chat-1",
			codingProviderId: "codex",
			codingSdkSessionId: "code-new",
			timestamp: 40,
		});
		links.upsert({
			chatAgentId: "agent-railly",
			chatProviderId: "claude",
			chatSdkSessionId: "chat-1",
			codingProviderId: "codex",
			codingSdkSessionId: "code-old",
			timestamp: 50,
		});
		links.upsert({
			chatAgentId: "agent-railly",
			chatProviderId: "claude",
			chatSdkSessionId: "chat-1",
			codingProviderId: "codex",
			codingSdkSessionId: "code-new",
			timestamp: 60,
		});

		expect(
			links
				.listForChat({
					chatAgentId: "agent-railly",
					chatProviderId: "claude",
					chatSdkSessionId: "chat-1",
				})
				.map((session) => session.sdkSessionId),
		).toEqual(["code-new", "code-old"]);

		codingSessions.delete("codex", "code-new");

		expect(
			links
				.listForChat({
					chatAgentId: "agent-railly",
					chatProviderId: "claude",
					chatSdkSessionId: "chat-1",
				})
				.map((session) => session.sdkSessionId),
		).toEqual(["code-old"]);

		chatSessions.delete("claude", "chat-1");

		expect(
			links.listForChat({
				chatAgentId: "agent-railly",
				chatProviderId: "claude",
				chatSdkSessionId: "chat-1",
			}),
		).toEqual([]);

		links.close();
		codingSessions.close();
		codingSharedSessions.close();
		chatSessions.close();
	});
});
