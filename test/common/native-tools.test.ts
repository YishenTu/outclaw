import { describe, expect, test } from "bun:test";
import {
	OUTCLAW_NATIVE_TOOL_CATALOG,
	validateOutclawNativeToolParams,
} from "../../src/common/native-tools.ts";

describe("native Outclaw tool catalog", () => {
	test("registers exactly the six native agent workflow tools", () => {
		expect(OUTCLAW_NATIVE_TOOL_CATALOG.map((tool) => tool.name)).toEqual([
			"outclaw_peer_message",
			"outclaw_memory_note",
			"outclaw_recall",
			"outclaw_schema",
			"outclaw_cron",
			"outclaw_coding",
		]);
	});

	test("declares the expected modes and safety classes", () => {
		const contracts = new Map(
			OUTCLAW_NATIVE_TOOL_CATALOG.map((tool) => [tool.name, tool]),
		);

		expect(contracts.get("outclaw_peer_message")).toMatchObject({
			safetyClasses: [],
			modes: [
				{ name: "list", safetyClasses: ["read-only"] },
				{ name: "ask", safetyClasses: ["long-running"] },
				{ name: "send", safetyClasses: ["state-changing"] },
			],
		});
		expect(contracts.get("outclaw_memory_note")).toMatchObject({
			safetyClasses: ["state-changing"],
			modes: [],
		});
		expect(contracts.get("outclaw_recall")).toMatchObject({
			safetyClasses: [],
			modes: [
				{ name: "sessions", safetyClasses: ["read-only"] },
				{ name: "transcript", safetyClasses: ["read-only"] },
			],
		});
		expect(contracts.get("outclaw_schema")).toMatchObject({
			safetyClasses: [],
			modes: [
				{ name: "all", safetyClasses: ["read-only"] },
				{ name: "stale", safetyClasses: ["read-only"] },
			],
		});
		expect(contracts.get("outclaw_cron")).toMatchObject({
			safetyClasses: [],
			modes: [
				{ name: "failed_status", safetyClasses: ["read-only"] },
				{ name: "run", safetyClasses: ["state-changing", "long-running"] },
			],
		});
		expect(contracts.get("outclaw_coding")).toMatchObject({
			safetyClasses: [],
			modes: [
				{ name: "list", safetyClasses: ["read-only"] },
				{ name: "start", safetyClasses: ["long-running"] },
				{ name: "resume", safetyClasses: ["long-running"] },
				{ name: "status", safetyClasses: ["read-only"] },
				{ name: "transcript", safetyClasses: ["read-only"] },
				{ name: "cancel", safetyClasses: ["state-changing"] },
			],
		});
	});

	test("rejects missing or empty required parameters before any tool behavior", () => {
		const invalidInputs = [
			[
				"outclaw_peer_message",
				{ mode: "ask", message: "hello" },
				"targetAgent",
			],
			[
				"outclaw_peer_message",
				{ mode: "send", targetAgent: "builder", message: "   " },
				"message",
			],
			["outclaw_memory_note", { text: "\t" }, "text"],
			["outclaw_recall", { mode: "transcript" }, "sessionRef"],
			["outclaw_schema", {}, "mode"],
			["outclaw_cron", { mode: "run" }, "jobName"],
			["outclaw_coding", { mode: "start", target: "workspace" }, "prompt"],
			["outclaw_coding", { mode: "resume", prompt: "continue" }, "sessionRef"],
		] as const;

		for (const [toolName, params, fieldName] of invalidInputs) {
			const result = validateOutclawNativeToolParams(toolName, params);

			expect(result).toMatchObject({
				ok: false,
				error: { code: "validation_error" },
			});
			if (!result.ok) {
				expect(result.error.message).toContain(fieldName);
			}
		}
	});

	test("rejects invalid values and parameters from the wrong mode", () => {
		const invalidInputs = [
			[
				"outclaw_peer_message",
				{
					mode: "send",
					targetAgent: "builder",
					message: "please review",
					timeoutSeconds: 30,
				},
				"timeoutSeconds",
			],
			[
				"outclaw_recall",
				{ mode: "sessions", sessionRef: "pi/thread-1" },
				"sessionRef",
			],
			["outclaw_recall", { mode: "sessions", tag: "code" }, "tag"],
			[
				"outclaw_recall",
				{ mode: "transcript", sessionRef: "thread-1" },
				"provider-qualified",
			],
			["outclaw_recall", { mode: "sessions", limit: 101 }, "limit"],
			[
				"outclaw_coding",
				{ mode: "status", sessionRef: "codex/thread-1", prompt: "continue" },
				"prompt",
			],
			[
				"outclaw_coding",
				{
					mode: "transcript",
					sessionRef: "codex/thread-1",
					turns: 2,
					full: true,
				},
				"full",
			],
			["outclaw_coding", { mode: "list", prompt: "continue" }, "prompt"],
		] as const;

		for (const [toolName, params, messagePart] of invalidInputs) {
			const result = validateOutclawNativeToolParams(toolName, params);

			expect(result).toMatchObject({
				ok: false,
				error: { code: "validation_error" },
			});
			if (!result.ok) {
				expect(result.error.message).toContain(messagePart);
			}
		}
	});

	test("accepts the valid parameter shape for every tool mode", () => {
		const validInputs = [
			["outclaw_peer_message", { mode: "list" }],
			[
				"outclaw_peer_message",
				{
					mode: "ask",
					targetAgent: "builder",
					message: "what changed?",
					timeoutSeconds: 30,
				},
			],
			[
				"outclaw_peer_message",
				{ mode: "send", targetAgent: "builder", message: "please review" },
			],
			[
				"outclaw_memory_note",
				{
					text: "User prefers direct answers.",
					salience: "decision",
					title: "Preference",
				},
			],
			[
				"outclaw_recall",
				{
					mode: "sessions",
					query: "deployment",
					limit: 10,
					tag: "chat",
				},
			],
			[
				"outclaw_recall",
				{
					mode: "transcript",
					sessionRef: "pi/thread-1",
					turns: 20,
					tag: "cron",
				},
			],
			["outclaw_schema", { mode: "all" }],
			["outclaw_schema", { mode: "stale", agent: "planner" }],
			[
				"outclaw_cron",
				{
					mode: "failed_status",
					jobName: "nightly",
					namesOnly: true,
					sinceEpochMs: 1770000000000,
					limit: 10,
				},
			],
			["outclaw_cron", { mode: "run", jobName: "nightly" }],
			[
				"outclaw_coding",
				{
					mode: "list",
					repository: "repo-1",
					includeArchived: true,
					limit: 20,
				},
			],
			[
				"outclaw_coding",
				{
					mode: "start",
					target: "repo",
					prompt: "implement the contract",
					cwd: "/tmp/project",
				},
			],
			[
				"outclaw_coding",
				{
					mode: "resume",
					sessionRef: "codex/thread-1",
					prompt: "continue",
				},
			],
			[
				"outclaw_coding",
				{
					mode: "status",
					sessionRef: "codex/thread-1",
					block: true,
					timeoutSeconds: 10,
				},
			],
			[
				"outclaw_coding",
				{
					mode: "transcript",
					sessionRef: "codex/thread-1",
					turns: 10,
				},
			],
			[
				"outclaw_coding",
				{ mode: "transcript", sessionRef: "codex/thread-1", full: true },
			],
			["outclaw_coding", { mode: "cancel", sessionRef: "codex/thread-1" }],
		] as const;

		for (const [toolName, params] of validInputs) {
			expect(validateOutclawNativeToolParams(toolName, params)).toMatchObject({
				ok: true,
				data: params,
			});
		}
	});

	test("describes selection guidance, safety behavior, and mode names", () => {
		for (const tool of OUTCLAW_NATIVE_TOOL_CATALOG) {
			expect(tool.description).toContain("Use when:");
			expect(tool.description).toContain("Do not use when:");
			expect(tool.description).toContain("Safety:");
			expect(tool.description).not.toMatch(/\boc\s+/);

			const modeNames =
				tool.modes.length === 0
					? ["none"]
					: tool.modes.map((mode) => mode.name);
			for (const modeName of modeNames) {
				expect(tool.description).toContain(modeName);
			}

			const safetyClasses = new Set([
				...tool.safetyClasses,
				...tool.modes.flatMap((mode) => mode.safetyClasses),
			]);
			for (const safetyClass of safetyClasses) {
				expect(tool.description).toContain(safetyClass);
			}
		}
	});
});
