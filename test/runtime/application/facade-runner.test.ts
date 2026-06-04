import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	Facade,
	FacadeEvent,
	PromptProvider,
	RunParams,
} from "../../../src/common/protocol.ts";
import { runFacadePrompt } from "../../../src/runtime/application/prompt-execution/facade-runner.ts";

function createPromptHome(files: Record<string, string>) {
	const dir = mkdtempSync(join(tmpdir(), "outclaw-facade-runner-"));
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(dir, name), content);
	}
	return dir;
}

function createFacade(
	events: FacadeEvent[],
	onRun: (params: RunParams) => void,
): Facade {
	return {
		providerId: "mock",
		async *run(params) {
			onRun(params);
			for (const event of events) {
				yield event;
			}
		},
	};
}

function createPromptProvider(
	events: FacadeEvent[],
	onRun: (params: RunParams) => void,
): PromptProvider {
	return {
		providerId: "mock",
		async *run(params) {
			onRun(params);
			for (const event of events) {
				yield event;
			}
		},
	};
}

describe("runFacadePrompt", () => {
	const promptHomes: string[] = [];

	afterEach(() => {
		for (const promptHome of promptHomes) {
			rmSync(promptHome, { force: true, recursive: true });
		}
		promptHomes.length = 0;
	});

	test("assembles facade run params and emits extracted image events", async () => {
		const promptHomeDir = createPromptHome({
			"AGENTS.md": "Agent instructions",
			"USER.md": "User context",
		});
		promptHomes.push(promptHomeDir);
		const imagePath = join(promptHomeDir, "result.png");
		writeFileSync(imagePath, "bytes");
		const capturedParams: RunParams[] = [];
		const emitted: FacadeEvent[] = [];

		await runFacadePrompt({
			abortController: new AbortController(),
			cwd: "/workspace/project",
			effort: "medium",
			emit: (event) => emitted.push(event),
			facade: createFacade(
				[
					{ type: "text", text: `created ${imagePath}` },
					{ type: "done", sessionId: "sdk-session", durationMs: 1 },
				],
				(params) => capturedParams.push(params),
			),
			model: "claude-opus",
			ocSessionId: "oc-session",
			prompt: "Build the chart",
			promptHomeDir,
			replyContext: { text: 'earlier "result" <ok>' },
			stream: true,
		});

		expect(capturedParams).toHaveLength(1);
		expect(capturedParams[0]).toMatchObject({
			prompt:
				"Build the chart\n\n<reply-context>earlier &quot;result&quot; &lt;ok&gt;</reply-context>",
			instructionPolicy: {
				mode: "runtime_constructed",
				systemPrompt:
					"<agents>\nAgent instructions\n</agents>\n\n<user>\nUser context\n</user>",
			},
			abortController: expect.any(AbortController),
			cwd: "/workspace/project",
			resourceHomeDir: promptHomeDir,
			model: "claude-opus",
			effort: "medium",
			sessionId: "oc-session",
			stream: true,
			sessionEnv: {
				OC_MEMORY_ROOT: promptHomeDir,
				OC_SESSION_ID: "oc-session",
			},
		});
		expect(
			"replyContext" in
				(capturedParams[0] as unknown as Record<string, unknown>),
		).toBe(false);
		expect(emitted).toEqual([
			{ type: "text", text: `created ${imagePath}` },
			{ type: "image", path: imagePath },
			{ type: "done", sessionId: "sdk-session", durationMs: 1 },
		]);
	});

	test("uses resume without sending a fresh session id", async () => {
		const capturedParams: RunParams[] = [];

		await runFacadePrompt({
			abortController: new AbortController(),
			effort: "medium",
			emit: () => {},
			facade: createFacade(
				[{ type: "done", sessionId: "resume-session", durationMs: 1 }],
				(params) => capturedParams.push(params),
			),
			model: "claude-opus",
			ocSessionId: "oc-session",
			prompt: "Resume",
			resume: "resume-session",
		});

		expect(capturedParams).toHaveLength(1);
		expect(capturedParams[0]?.resume).toBe("resume-session");
		expect(capturedParams[0]?.sessionId).toBeUndefined();
		expect(capturedParams[0]?.sessionEnv).toBeUndefined();
	});

	test("accepts a prompt provider without catalog or history roles", async () => {
		const capturedParams: RunParams[] = [];

		await runFacadePrompt({
			emit: () => {},
			facade: createPromptProvider(
				[{ type: "done", sessionId: "prompt-session", durationMs: 1 }],
				(params) => capturedParams.push(params),
			),
			ocSessionId: "oc-session",
			prompt: "Run through the prompt provider role",
		});

		expect(capturedParams).toHaveLength(1);
		expect(capturedParams[0]?.sessionId).toBe("oc-session");
	});
});
