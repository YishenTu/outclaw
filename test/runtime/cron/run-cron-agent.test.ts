import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	Facade,
	FacadeEvent,
	ProviderModelInfo,
	RunParams,
} from "../../../src/common/protocol.ts";
import { createCronAgentRunner } from "../../../src/runtime/cron/run-cron-agent.ts";
import {
	createModelProviderResolver,
	staticModelProviderResolver,
} from "../../../src/runtime/model-provider-resolver.ts";

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
		providerId: "mock",
		async *run(params) {
			onRun?.(params);
			for (const event of events) {
				yield event;
			}
		},
	};
}

function model(id: string): ProviderModelInfo {
	return {
		id,
		model: id,
		displayName: id,
		description: "",
		isDefault: false,
		defaultReasoningEffort: "medium",
		supportedReasoningEfforts: ["medium"],
		serviceTiers: [],
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

	test("assembles the system prompt, preserves provider-local model ids, and collects text output", async () => {
		const promptHomeDir = createPromptHome({
			"AGENTS.md": "Agent instructions",
			"USER.md": "User context",
		});
		promptHomes.push(promptHomeDir);

		let receivedParams: RunParams | undefined;
		const facade = createFacade(
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
		);
		const runCronAgent = createCronAgentRunner({
			providers: { getFacade: () => facade },
			modelProviderResolver: staticModelProviderResolver("claude"),
			promptHomeDir,
			cwd: "/workspace/project",
		});

		const result = await runCronAgent(
			"Summarize overnight changes",
			"opus",
			"max",
		);

		expect(receivedParams).toMatchObject({
			prompt: "Summarize overnight changes",
			instructionPolicy: {
				mode: "runtime_constructed",
				systemPrompt:
					"<agents>\nAgent instructions\n</agents>\n\n<user>\nUser context\n</user>",
			},
			cwd: "/workspace/project",
			model: "opus",
			effort: "max",
			stream: false,
		});
		expect(receivedParams?.sessionEnv?.OC_MEMORY_ROOT).toBe(promptHomeDir);
		expect(
			receivedParams?.sessionEnv?.OC_SESSION_ID?.length ?? 0,
		).toBeGreaterThan(0);
		expect(receivedParams?.sessionId).toBe(
			receivedParams?.sessionEnv?.OC_SESSION_ID,
		);
		expect(result).toEqual({
			providerId: "claude",
			sessionId: "cron-session-123",
			text: "hello world",
		});
	});

	test("rejects cron runs that omit the model field — provider can't be inferred", async () => {
		const promptHomeDir = createPromptHome({});
		promptHomes.push(promptHomeDir);

		const facade = createFacade(
			[{ type: "done", sessionId: "cron-session-456", durationMs: 1 }],
			() => {},
		);
		const runCronAgent = createCronAgentRunner({
			providers: { getFacade: () => facade },
			modelProviderResolver: staticModelProviderResolver("claude"),
			promptHomeDir,
			cwd: "/workspace/project",
		});

		await expect(runCronAgent("Keep the default model")).rejects.toThrow(
			"requires an explicit `model` field",
		);
	});

	test("routes cron runs to the Codex facade when the model resolves through the catalog", async () => {
		const promptHomeDir = createPromptHome({});
		promptHomes.push(promptHomeDir);

		const claudeCalls: RunParams[] = [];
		const codexCalls: RunParams[] = [];
		const claudeFacade = createFacade(
			[{ type: "done", sessionId: "claude-cron", durationMs: 1 }],
			(params) => claudeCalls.push(params),
		);
		const codexFacade = createFacade(
			[
				{ type: "text", text: "codex ran" },
				{ type: "done", sessionId: "codex-cron", durationMs: 1 },
			],
			(params) => codexCalls.push(params),
		);
		const runCronAgent = createCronAgentRunner({
			providers: {
				getFacade(providerId) {
					if (providerId === "codex") return codexFacade;
					return claudeFacade;
				},
			},
			modelProviderResolver: createModelProviderResolver([
				{
					providerId: "claude",
					listModels: async () => [model("haiku")],
				},
				{
					providerId: "codex",
					listModels: async () => [model("gpt-5.5")],
				},
			]),
			promptHomeDir,
			cwd: "/workspace/project",
		});

		const result = await runCronAgent("Run the nightly batch", "gpt-5.5");

		expect(claudeCalls).toHaveLength(0);
		expect(codexCalls).toHaveLength(1);
		// Non-Claude model ids pass through verbatim (no alias resolution).
		expect(codexCalls[0]?.model).toBe("gpt-5.5");
		expect(result).toEqual({
			providerId: "codex",
			sessionId: "codex-cron",
			text: "codex ran",
		});
	});

	test("rejects unknown provider models instead of inferring from prefixes", async () => {
		const promptHomeDir = createPromptHome({});
		promptHomes.push(promptHomeDir);

		const calls: RunParams[] = [];
		const facade = createFacade(
			[{ type: "done", sessionId: "cron-session-unknown", durationMs: 1 }],
			(params) => calls.push(params),
		);
		const runCronAgent = createCronAgentRunner({
			providers: { getFacade: () => facade },
			modelProviderResolver: createModelProviderResolver([
				{
					providerId: "codex",
					listModels: async () => [model("gpt-5.5")],
				},
			]),
			promptHomeDir,
			cwd: "/workspace/project",
		});

		await expect(
			runCronAgent("Run with an unknown Codex model", "gpt-unknown"),
		).rejects.toThrow(
			"Cron job model gpt-unknown does not resolve to a known provider",
		);
		expect(calls).toEqual([]);
	});

	test("throws the cron session id when the facade emits an error event", async () => {
		const promptHomeDir = createPromptHome({});
		promptHomes.push(promptHomeDir);

		let receivedParams: RunParams | undefined;
		const facade = createFacade(
			[{ type: "error", message: "agent exploded" }],
			(params) => {
				receivedParams = params;
			},
		);
		const runCronAgent = createCronAgentRunner({
			providers: { getFacade: () => facade },
			modelProviderResolver: staticModelProviderResolver("claude"),
			promptHomeDir,
			cwd: "/workspace/project",
		});

		let thrown: unknown;
		try {
			await runCronAgent("Fail loudly", "haiku");
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).toBe("agent exploded");
		expect((thrown as { providerId?: string }).providerId).toBe("claude");
		expect((thrown as { sessionId?: string }).sessionId).toBe(
			receivedParams?.sessionId,
		);
	});
});
