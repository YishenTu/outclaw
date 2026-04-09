import { describe, expect, mock, test } from "bun:test";
import { RUNTIME_COMMANDS } from "../../src/common/commands.ts";
import { TELEGRAM_COMMANDS } from "../../src/frontend/telegram/commands.ts";
import {
	executeTelegramRuntimeCommand,
	registerTelegramRuntimeCommands,
	TELEGRAM_RUNTIME_COMMAND_NAMES,
} from "../../src/frontend/telegram/runtime-commands.ts";

describe("Telegram runtime commands", () => {
	test("advertised commands mirror runtime command metadata", () => {
		expect(
			TELEGRAM_COMMANDS.map(({ command, description }) => ({
				command,
				description,
			})),
		).toEqual(
			RUNTIME_COMMANDS.map(({ command, description }) => ({
				command,
				description,
			})),
		);
		expect(TELEGRAM_RUNTIME_COMMAND_NAMES).toEqual(
			RUNTIME_COMMANDS.map((command) => command.command),
		);
	});

	test("/new formats the session cleared reply", async () => {
		const calls: Array<{ command: string; expectedTypes: string[] }> = [];
		const reply = await executeTelegramRuntimeCommand("new", {
			sendCommandAndWait: async (command, expectedTypes) => {
				calls.push({
					command,
					expectedTypes: [...(expectedTypes ?? [])],
				});
				return { type: "session_cleared" };
			},
		});

		expect(calls).toEqual([
			{ command: "/new", expectedTypes: ["session_cleared"] },
		]);
		expect(reply).toBe("Session cleared. Starting fresh.");
	});

	test("/model trims the match, forwards expected types, and formats success", async () => {
		const calls: Array<{ command: string; expectedTypes: string[] }> = [];
		const reply = await executeTelegramRuntimeCommand(
			"model",
			{
				sendCommandAndWait: async (command, expectedTypes) => {
					calls.push({
						command,
						expectedTypes: [...(expectedTypes ?? [])],
					});
					return { type: "model_changed", model: "sonnet" };
				},
			},
			" sonnet ",
		);

		expect(calls).toEqual([
			{ command: "/model sonnet", expectedTypes: ["model_changed"] },
		]);
		expect(reply).toBe("Model: sonnet");
	});

	test("/model formats runtime errors", async () => {
		const reply = await executeTelegramRuntimeCommand("model", {
			sendCommandAndWait: async () => ({
				type: "error",
				message: "invalid alias",
			}),
		});

		expect(reply).toBe("[error] invalid alias");
	});

	test("/thinking without an argument requests the current effort", async () => {
		const calls: string[] = [];
		const reply = await executeTelegramRuntimeCommand("thinking", {
			sendCommandAndWait: async (command) => {
				calls.push(command);
				return { type: "effort_changed", effort: "high" };
			},
		});

		expect(calls).toEqual(["/thinking"]);
		expect(reply).toBe("Thinking effort: high");
	});

	test("/session formats the active session info", async () => {
		const reply = await executeTelegramRuntimeCommand("session", {
			sendCommandAndWait: async () => ({
				type: "session_info",
				sdkSessionId: "sdk-session-123",
				title: "Current chat",
				model: "opus",
			}),
		});

		expect(reply).toBe(
			"Session: sdk-session-123\nTitle: Current chat\nModel: opus",
		);
	});

	test("/session formats session lists and empty lists", async () => {
		const listed = await executeTelegramRuntimeCommand(
			"session",
			{
				sendCommandAndWait: async () => ({
					type: "session_list",
					sessions: [
						{ sdkSessionId: "abcdef123456", title: "First session" },
						{ sdkSessionId: "9876543210fedcba", title: "Second session" },
					],
				}),
			},
			"list",
		);
		const empty = await executeTelegramRuntimeCommand("session", {
			sendCommandAndWait: async () => ({
				type: "session_list",
				sessions: [],
			}),
		});

		expect(listed).toBe("abcdef12  First session\n98765432  Second session");
		expect(empty).toBe("No sessions");
	});

	test("/session formats session switches", async () => {
		const reply = await executeTelegramRuntimeCommand("session", {
			sendCommandAndWait: async () => ({
				type: "session_switched",
				title: "Recovered chat",
			}),
		});

		expect(reply).toBe("Switched to: Recovered chat");
	});

	test("/session formats runtime errors", async () => {
		const reply = await executeTelegramRuntimeCommand("session", {
			sendCommandAndWait: async () => ({
				type: "error",
				message: "unknown session",
			}),
		});

		expect(reply).toBe("[error] unknown session");
	});

	test("/status formats usage when present and falls back to n/a", async () => {
		const withUsage = await executeTelegramRuntimeCommand("status", {
			sendCommandAndWait: async () => ({
				type: "runtime_status",
				model: "opus",
				effort: "high",
				sessionId: "sdk-session-123",
				usage: {
					contextTokens: 12345,
					contextWindow: 200000,
					percentage: 6,
				},
			}),
		});
		const withoutUsage = await executeTelegramRuntimeCommand("status", {
			sendCommandAndWait: async () => ({
				type: "runtime_status",
				model: "haiku",
				effort: "low",
			}),
		});

		expect(withUsage).toBe(
			"Model: opus\nEffort: high\nSession: sdk-session-123\nContext: 12,345/200,000 (6%)",
		);
		expect(withoutUsage).toBe(
			"Model: haiku\nEffort: low\nSession: none\nContext: n/a",
		);
	});

	test("/stop forwards to runtime and returns the status reply", async () => {
		const calls: string[] = [];
		const reply = await executeTelegramRuntimeCommand("stop", {
			sendCommandAndWait: async (command) => {
				calls.push(command);
				return { type: "status", message: "Stopping current run" };
			},
		});

		expect(calls).toEqual(["/stop"]);
		expect(reply).toBe("Stopping current run");
	});

	test("unexpected non-error events return no reply text", async () => {
		const reply = await executeTelegramRuntimeCommand("stop", {
			sendCommandAndWait: async () => ({ type: "done" }),
		});

		expect(reply).toBeUndefined();
	});

	test("registerTelegramRuntimeCommands wires handlers to the bridge", async () => {
		const handlers = new Map<
			string,
			(ctx: {
				match?: string;
				reply(text: string): Promise<unknown>;
			}) => Promise<void>
		>();
		const registrar = {
			command: (
				command: string,
				handler: (ctx: {
					match?: string;
					reply(text: string): Promise<unknown>;
				}) => Promise<void>,
			) => {
				handlers.set(command, handler);
			},
		};
		const calls: string[] = [];
		registerTelegramRuntimeCommands(registrar, {
			sendCommandAndWait: async (command) => {
				calls.push(command);
				if (command === "/model sonnet") {
					return { type: "model_changed", model: "sonnet" };
				}
				return { type: "done" };
			},
		});

		expect([...handlers.keys()]).toEqual(TELEGRAM_RUNTIME_COMMAND_NAMES);

		const modelReply = mock(async (_text: string) => undefined);
		await handlers.get("model")?.({ match: " sonnet ", reply: modelReply });
		expect(calls).toContain("/model sonnet");
		expect(modelReply).toHaveBeenCalledWith("Model: sonnet");

		const stopReply = mock(async (_text: string) => undefined);
		await handlers.get("stop")?.({ reply: stopReply });
		expect(calls).toContain("/stop");
		expect(stopReply).not.toHaveBeenCalled();
	});
});
