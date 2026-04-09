import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	Facade,
	FacadeEvent,
	RunParams,
} from "../../../src/common/protocol.ts";
import { createCronAgentRunner } from "../../../src/runtime/cron/run-cron-agent.ts";

function createPromptHome(files: Record<string, string>) {
	const dir = mkdtempSync(join(tmpdir(), "mis-cron-agent-"));
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(dir, name), content);
	}
	return dir;
}

function createFacade(
	events: FacadeEvent[],
	onRun?: (params: RunParams) => void,
): Facade {
	return {
		async *run(params) {
			onRun?.(params);
			for (const event of events) {
				yield event;
			}
		},
	};
}

describe("createCronAgentRunner", () => {
	const promptHomes: string[] = [];

	afterEach(() => {
		for (const promptHome of promptHomes) {
			rmSync(promptHome, { force: true, recursive: true });
		}
		promptHomes.length = 0;
	});

	test("assembles the system prompt, resolves aliases, and collects text output", async () => {
		const promptHomeDir = createPromptHome({
			"AGENTS.md": "Agent instructions",
			"USER.md": "User context",
		});
		promptHomes.push(promptHomeDir);

		let receivedParams: RunParams | undefined;
		const runCronAgent = createCronAgentRunner({
			facade: createFacade(
				[
					{ type: "text", text: "hello " },
					{ type: "text", text: "world" },
					{
						type: "done",
						sessionId: "cron-session-123",
						durationMs: 1,
					},
				],
				(params) => {
					receivedParams = params;
				},
			),
			promptHomeDir,
			cwd: "/workspace/project",
			effort: "max",
		});

		const result = await runCronAgent("Summarize overnight changes", "opus");

		expect(receivedParams).toEqual({
			prompt: "Summarize overnight changes",
			systemPrompt:
				"<agents>\nAgent instructions\n</agents>\n\n<user>\nUser context\n</user>",
			cwd: "/workspace/project",
			model: "claude-opus-4-6[1m]",
			effort: "max",
			stream: false,
		});
		expect(result).toEqual({
			sessionId: "cron-session-123",
			text: "hello world",
		});
	});

	test("leaves model undefined when no model is provided", async () => {
		const promptHomeDir = createPromptHome({});
		promptHomes.push(promptHomeDir);

		let receivedParams: RunParams | undefined;
		const runCronAgent = createCronAgentRunner({
			facade: createFacade(
				[
					{
						type: "done",
						sessionId: "cron-session-456",
						durationMs: 1,
					},
				],
				(params) => {
					receivedParams = params;
				},
			),
			promptHomeDir,
			cwd: "/workspace/project",
		});

		const result = await runCronAgent("Keep the default model");

		expect(receivedParams?.model).toBeUndefined();
		expect(receivedParams?.systemPrompt).toBe("");
		expect(receivedParams?.stream).toBeFalse();
		expect(result).toEqual({
			sessionId: "cron-session-456",
			text: "",
		});
	});

	test("throws when the facade emits an error event", async () => {
		const promptHomeDir = createPromptHome({});
		promptHomes.push(promptHomeDir);

		const runCronAgent = createCronAgentRunner({
			facade: createFacade([{ type: "error", message: "agent exploded" }]),
			promptHomeDir,
			cwd: "/workspace/project",
		});

		await expect(runCronAgent("Fail loudly", "haiku")).rejects.toThrow(
			"agent exploded",
		);
	});
});
