import { afterEach, describe, expect, test, vi } from "bun:test";
import { DEFAULT_EFFORT, DEFAULT_MODEL } from "../../../src/common/commands.ts";
import { MODELS } from "../../../src/common/models.ts";
import type {
	Facade,
	FacadeEvent,
	RunParams,
} from "../../../src/common/protocol.ts";
import {
	AutoTitleCoordinator,
	buildAutoTitlePrompt,
	normalizeAutoTitle,
} from "../../../src/runtime/application/auto-title.ts";
import type { SessionService } from "../../../src/runtime/application/session-service.ts";
import type { RuntimePromptContext } from "../../../src/runtime/application/state/runtime-state.ts";

afterEach(() => {
	vi.useRealTimers();
});

function createDeferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

describe("buildAutoTitlePrompt", () => {
	test("wraps the request with explicit title-only instructions", () => {
		const prompt = buildAutoTitlePrompt(
			"  Explain why the browser tab turns blank after auto title.  ",
		);

		expect(prompt).toContain("Do not answer the request");
		expect(prompt).toContain("Summarize the user's intent as a title only");
		expect(prompt).toContain(
			"<request>\nExplain why the browser tab turns blank after auto title.\n</request>",
		);
		expect(prompt).not.toBe(
			"Explain why the browser tab turns blank after auto title.",
		);
	});
});

describe("normalizeAutoTitle", () => {
	test("strips wrappers, keeps the first line, collapses whitespace, and trims trailing punctuation", () => {
		expect(
			normalizeAutoTitle('"  Debug   Telegram    delivery.  "\nextra text'),
		).toBe("Debug Telegram delivery");
		expect(normalizeAutoTitle("`Fix session rename?`")).toBe(
			"Fix session rename",
		);
	});

	test("caps long titles at a word boundary without adding an ellipsis", () => {
		expect(
			normalizeAutoTitle(
				"Investigate websocket routing regressions caused by stale session state in the browser sidebar",
			),
		).toBe("Investigate websocket routing regressions caused by stale");
	});

	test("returns undefined for empty normalized titles", () => {
		expect(normalizeAutoTitle(" \n ")).toBeUndefined();
		expect(normalizeAutoTitle("...")).toBeUndefined();
	});
});

describe("AutoTitleCoordinator", () => {
	test("lets title generation continue past the old deadline", async () => {
		vi.useFakeTimers();
		const releaseTitle = createDeferred();
		const appliedTitles: string[] = [];
		let titleParams: RunParams | undefined;
		const facade: Facade = {
			providerId: "mock",
			async *run(params: RunParams): AsyncIterable<FacadeEvent> {
				titleParams = params;
				await releaseTitle.promise;
				yield { type: "text", text: "Slow generated title" };
				yield {
					type: "done",
					sessionId: "ephemeral-title-session",
					durationMs: 1,
				};
			},
		};
		const sessions = {
			canPersistSessions: true,
			applyAutoTitle(params: { title: string }) {
				appliedTitles.push(params.title);
				return true;
			},
		} as Pick<SessionService, "applyAutoTitle" | "canPersistSessions">;
		const coordinator = new AutoTitleCoordinator({
			facade,
			model: MODELS.haiku.id,
			sessions: sessions as SessionService,
		});
		const context: RuntimePromptContext = {
			effort: DEFAULT_EFFORT,
			fallbackSessionTitle: "Explain slow title generation",
			generation: 0,
			model: DEFAULT_MODEL,
			ocSessionId: "oc-title",
			resolvedModel: MODELS[DEFAULT_MODEL].id,
			sessionSource: "tui",
		};

		coordinator.start({
			context,
			prompt: "Explain slow title generation",
			source: "tui",
		});
		await Promise.resolve();
		await Promise.resolve();
		vi.advanceTimersByTime(15_001);
		await Promise.resolve();

		expect(titleParams?.abortController?.signal.aborted).toBe(false);
		coordinator.resolveSession("oc-title", "sdk-title");
		releaseTitle.resolve();
		await coordinator.drain();

		expect(appliedTitles).toEqual(["Slow generated title"]);
	});
});
