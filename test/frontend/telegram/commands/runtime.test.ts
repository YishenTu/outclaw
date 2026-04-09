import { describe, expect, mock, test } from "bun:test";
import { RUNTIME_COMMANDS } from "../../../../src/common/commands.ts";
import { TELEGRAM_COMMANDS } from "../../../../src/frontend/telegram/commands/catalog.ts";
import {
	executeTelegramRuntimeCommand,
	registerTelegramRuntimeCommands,
	TELEGRAM_RUNTIME_COMMAND_NAMES,
} from "../../../../src/frontend/telegram/commands/runtime.ts";

describe("Telegram runtime commands", () => {
	test("advertised commands cover all runtime commands", () => {
		const advertised = new Set(TELEGRAM_COMMANDS.map((c) => c.command));
		for (const rc of RUNTIME_COMMANDS) {
			expect(advertised.has(rc.command)).toBe(true);
		}
	});

	test("session is handled separately from auto-registered commands", () => {
		expect(TELEGRAM_RUNTIME_COMMAND_NAMES).not.toContain("session");
		expect(
			TELEGRAM_COMMANDS.find((c) => c.command === "session"),
		).toBeDefined();
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
