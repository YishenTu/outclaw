import { describe, expect, test } from "bun:test";
import type {
	Facade,
	FacadeEvent,
	RunParams,
} from "../../../src/common/protocol.ts";
import { PromptRunner } from "../../../src/runtime/application/prompt-runner.ts";

function createFacade(
	scripts: FacadeEvent[][],
	onRun: (params: RunParams) => void,
): Facade {
	let callIndex = 0;
	return {
		providerId: "test",
		async *run(params: RunParams): AsyncIterable<FacadeEvent> {
			onRun(params);
			const events = scripts[callIndex] ?? [];
			callIndex += 1;
			for (const event of events) {
				yield event;
			}
		},
	};
}

describe("PromptRunner OC_SESSION_ID stability", () => {
	test("forwards the caller-provided id to both sessionEnv and fresh-run sessionId", async () => {
		const captured: RunParams[] = [];
		const facade = createFacade(
			[[{ type: "done", sessionId: "sdk-first", durationMs: 1 }]],
			(params) => captured.push(params),
		);
		const runner = new PromptRunner({ facade, promptHomeDir: "/home" });

		await runner.run({
			abortController: new AbortController(),
			effort: "medium",
			emit: () => {},
			model: "opus",
			ocSessionId: "oc-stable",
			task: { prompt: "hi" },
		});

		expect(captured).toHaveLength(1);
		expect(captured[0]?.sessionEnv).toEqual({
			OC_MEMORY_ROOT: "/home",
			OC_SESSION_ID: "oc-stable",
		});
		expect(captured[0]?.sessionId).toBe("oc-stable");
		expect(captured[0]?.resume).toBeUndefined();
	});

	test("does not pass a fresh-run sessionId when resuming", async () => {
		const captured: RunParams[] = [];
		const facade = createFacade(
			[[{ type: "done", sessionId: "sdk-stable", durationMs: 1 }]],
			(params) => captured.push(params),
		);
		const runner = new PromptRunner({ facade, promptHomeDir: "/home" });

		await runner.run({
			abortController: new AbortController(),
			effort: "medium",
			emit: () => {},
			model: "opus",
			ocSessionId: "sdk-stable",
			resume: "sdk-stable",
			task: { prompt: "resume me" },
		});

		expect(captured).toHaveLength(1);
		expect(captured[0]?.resume).toBe("sdk-stable");
		expect(captured[0]?.sessionId).toBeUndefined();
		expect(captured[0]?.sessionEnv).toEqual({
			OC_MEMORY_ROOT: "/home",
			OC_SESSION_ID: "sdk-stable",
		});
	});

	test("omits sessionEnv when promptHomeDir is not set", async () => {
		const captured: (RunParams["sessionEnv"] | undefined)[] = [];
		const facade = createFacade(
			[[{ type: "done", sessionId: "sdk", durationMs: 1 }]],
			(params) => captured.push(params.sessionEnv),
		);
		const runner = new PromptRunner({ facade });

		await runner.run({
			abortController: new AbortController(),
			effort: "medium",
			emit: () => {},
			model: "opus",
			ocSessionId: "unused-when-no-home",
			task: { prompt: "hi" },
		});

		expect(captured[0]).toBeUndefined();
	});
});
