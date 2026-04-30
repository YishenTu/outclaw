import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	formatSessionList,
	formatSessionSearchMatches,
	resolveScopedAgent,
} from "../../src/cli/session-read-model.ts";
import type { AgentRecord } from "../../src/runtime/agents/agent-record.ts";
import type { SessionSearchMatch } from "../../src/runtime/persistence/session-query.ts";
import type { SessionRow } from "../../src/runtime/persistence/session-store.ts";

function createAgent(agentId: string, name: string): AgentRecord {
	return {
		agentId,
		name,
		homeDir: `/tmp/${name}`,
		promptHomeDir: `/tmp/${name}`,
		configPath: "/tmp/config.json",
		config: {
			rollover: {
				idleMinutes: 240,
			},
			terminal: {
				runCommand: "",
			},
			telegram: {
				botToken: "",
				allowedUsers: [],
				defaultCronUserId: undefined,
			},
		},
	};
}

function createSession(overrides: Partial<SessionRow>): SessionRow {
	return {
		agentId: "agent-railly",
		createdAt: 0,
		lastActive: 60_000,
		model: "opus",
		ocSessionId: undefined,
		providerId: "claude",
		sdkSessionId: "abcdefghijklmnop",
		source: "tui",
		tag: "chat",
		title: "Chat title",
		...overrides,
	};
}

describe("session read model", () => {
	test("resolves cwd scope from a matching .agent-id file", () => {
		const tempDir = mkdtempSync(join(tmpdir(), "outclaw-session-scope-"));
		try {
			writeFileSync(join(tempDir, ".agent-id"), "agent-mimi\n");
			const agents = [
				createAgent("agent-railly", "railly"),
				createAgent("agent-mimi", "mimi"),
			];

			expect(resolveScopedAgent(agents, tempDir)?.name).toBe("mimi");
			expect(resolveScopedAgent(agents, join(tempDir, "missing"))).toBe(
				undefined,
			);
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	});

	test("formats session rows with agent names and collision-safe display ids", () => {
		const agents = [createAgent("agent-railly", "railly")];
		const sessions = [
			createSession({
				sdkSessionId: "abcdefghijklmnop",
				title: "First\nchat",
			}),
			createSession({
				sdkSessionId: "abcdefghijklzzzz",
				title: "Second chat",
			}),
		];

		expect(formatSessionList(sessions, agents)).toContain(
			[
				"agent\tid\ttitle\tcreated\tlast_active",
				`railly\tabcdefghijklm\tFirst chat\t${formatLocalTimestamp(
					0,
				)}\t${formatLocalTimestamp(60_000)}`,
				`railly\tabcdefghijklz\tSecond chat\t${formatLocalTimestamp(
					0,
				)}\t${formatLocalTimestamp(60_000)}`,
			].join("\n"),
		);
	});

	test("formats search matches with provider and agent metadata", () => {
		const matches: SessionSearchMatch[] = [
			{
				session: createSession({
					providerId: "claude",
					title: "Searchable chat",
				}),
				turns: [
					{
						bodyText: "matched text",
						role: "assistant",
						timestamp: 123_000,
					},
				],
			},
		];

		expect(
			formatSessionSearchMatches(matches, [
				createAgent("agent-railly", "railly"),
			]),
		).toBe(
			[
				"session: Searchable chat (abcdefghijkl)",
				"agent: railly",
				"provider: claude",
				`[assistant] ${formatLocalTimestamp(123_000)}`,
				"matched text",
			].join("\n"),
		);
	});
});

function formatLocalTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${year}-${month}-${day} ${hours}:${minutes}`;
}
