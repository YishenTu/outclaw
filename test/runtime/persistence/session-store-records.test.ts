import { describe, expect, test } from "bun:test";
import {
	mapSessionRow,
	mapSessionRows,
	mapUsageRow,
} from "../../../src/runtime/persistence/session-store/session-store-records.ts";

describe("session-store-records", () => {
	test("mapSessionRow converts a database row to the runtime shape", () => {
		expect(
			mapSessionRow({
				agent_id: "agent-railly",
				provider_id: "claude",
				sdk_session_id: "sdk-123",
				oc_session_id: "oc-123",
				title: "Chat",
				model: "sonnet",
				source: "telegram",
				tag: "chat",
				created_at: 1,
				last_active: 2,
				failed_at: 3,
				failure_message: "agent exploded",
			}),
		).toEqual({
			agentId: "agent-railly",
			providerId: "claude",
			sdkSessionId: "sdk-123",
			ocSessionId: "oc-123",
			title: "Chat",
			model: "sonnet",
			source: "telegram",
			tag: "chat",
			createdAt: 1,
			lastActive: 2,
			failedAt: 3,
			failureMessage: "agent exploded",
			autoTitleAttempted: false,
		});
	});

	test("mapSessionRows converts multiple database rows", () => {
		expect(
			mapSessionRows([
				{
					agent_id: "agent-railly",
					provider_id: "claude",
					sdk_session_id: "sdk-1",
					oc_session_id: "oc-1",
					title: "One",
					model: "haiku",
					source: "tui",
					tag: "chat",
					created_at: 10,
					last_active: 20,
					failed_at: null,
					failure_message: null,
				},
				{
					agent_id: "agent-mimi",
					provider_id: "claude",
					sdk_session_id: "sdk-2",
					oc_session_id: null,
					title: "Two",
					model: "opus",
					source: "telegram",
					tag: "cron",
					created_at: 30,
					last_active: 40,
					failed_at: 41,
					failure_message: "cron failed",
				},
			]),
		).toEqual([
			{
				agentId: "agent-railly",
				providerId: "claude",
				sdkSessionId: "sdk-1",
				ocSessionId: "oc-1",
				title: "One",
				model: "haiku",
				source: "tui",
				tag: "chat",
				createdAt: 10,
				lastActive: 20,
				failedAt: undefined,
				failureMessage: undefined,
				autoTitleAttempted: false,
			},
			{
				agentId: "agent-mimi",
				providerId: "claude",
				sdkSessionId: "sdk-2",
				ocSessionId: undefined,
				title: "Two",
				model: "opus",
				source: "telegram",
				tag: "cron",
				createdAt: 30,
				lastActive: 40,
				failedAt: 41,
				failureMessage: "cron failed",
				autoTitleAttempted: false,
			},
		]);
	});

	test("mapUsageRow converts nullable database fields into usage info", () => {
		expect(
			mapUsageRow({
				input_tokens: 100,
				output_tokens: null,
				cache_creation_tokens: 5,
				cache_read_tokens: null,
				context_window: 200_000,
				max_output_tokens: 8_000,
				context_tokens: null,
				percentage: 7,
			}),
		).toEqual({
			inputTokens: 100,
			outputTokens: 0,
			cacheCreationTokens: 5,
			cacheReadTokens: 0,
			contextWindow: 200_000,
			maxOutputTokens: 8_000,
			contextTokens: 0,
			percentage: 7,
		});
	});

	test("mapUsageRow returns undefined when no persisted usage exists", () => {
		expect(
			mapUsageRow({
				input_tokens: 1,
				output_tokens: 2,
				cache_creation_tokens: 3,
				cache_read_tokens: 4,
				context_window: null,
				max_output_tokens: 5,
				context_tokens: 6,
				percentage: 7,
			}),
		).toBeUndefined();
	});
});
