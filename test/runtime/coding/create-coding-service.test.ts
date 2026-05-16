import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	CodingSessionEvent,
	FacadeEvent,
	ProviderCodingSessionUpdate,
	RunParams,
} from "../../../src/common/protocol.ts";
import {
	CODING_STORAGE_OWNER_ID,
	CodingRepositoryStore,
	CodingSessionEventHub,
	CodingSessionStore,
	createCodingService,
} from "../../../src/runtime/coding/index.ts";
import { SessionStore } from "../../../src/runtime/persistence/session-store/session-store.ts";
import { MockFacade } from "../../helpers/mock-facade.ts";

interface Harness {
	cleanup(): Promise<void>;
	codingFacade: MockFacade;
	codingService: ReturnType<typeof createCodingService>;
	codingSessions: CodingSessionStore;
	codingSharedStore: SessionStore;
	dbPath: string;
}

const harnesses: Harness[] = [];

function makeHarness(facade?: MockFacade): Harness {
	const dir = mkdtempSync(join(tmpdir(), "outclaw-coding-service-"));
	const dbPath = join(dir, "sessions.sqlite");
	const codingSharedStore = new SessionStore(dbPath, {
		agentId: CODING_STORAGE_OWNER_ID,
	});
	const codingSessions = new CodingSessionStore(dbPath);
	const codingRepositories = new CodingRepositoryStore(dbPath);
	const codingEvents = new CodingSessionEventHub();
	const codingFacade = facade ?? new SessionInitializingFacade();
	const codingService = createCodingService({
		facade: codingFacade,
		repositories: codingRepositories,
		sessions: codingSessions,
		events: codingEvents,
		sharedSessionStore: codingSharedStore,
	});
	const harness: Harness = {
		codingFacade,
		codingService,
		codingSessions,
		codingSharedStore,
		dbPath,
		async cleanup() {
			await codingService.stop();
			codingEvents.close();
			codingSessions.close();
			codingRepositories.close();
			codingSharedStore.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
	harnesses.push(harness);
	return harness;
}

class SessionInitializingFacade extends MockFacade {
	override async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		yield { type: "session_initialized", sessionId: "facade-session-1" };
		yield* super.run(params);
	}
}

class ProviderSyncFacade extends SessionInitializingFacade {
	override providerId = "codex";
	readonly archiveCalls: string[] = [];
	readonly reconcileCalls: string[][] = [];
	reconcileResponses: ProviderCodingSessionUpdate[] = [];
	readonly restoreCalls: string[] = [];
	readonly renameCalls: Array<{ sessionId: string; title: string }> = [];
	subscribeCalls = 0;

	async archiveCodingSession(sessionId: string): Promise<void> {
		this.archiveCalls.push(sessionId);
	}

	async restoreCodingSession(sessionId: string): Promise<void> {
		this.restoreCalls.push(sessionId);
	}

	async renameCodingSession(sessionId: string, title: string): Promise<void> {
		this.renameCalls.push({ sessionId, title });
	}

	async reconcileCodingSessions(
		sessionIds: string[],
	): Promise<ProviderCodingSessionUpdate[]> {
		this.reconcileCalls.push(sessionIds);
		return this.reconcileResponses;
	}

	subscribeCodingSessionUpdates(
		_handler: (update: ProviderCodingSessionUpdate) => void,
	): () => void {
		this.subscribeCalls += 1;
		return () => {};
	}
}

afterEach(async () => {
	while (harnesses.length > 0) {
		const harness = harnesses.pop();
		try {
			await harness?.cleanup();
		} catch {
			// already cleaned
		}
	}
});

describe("createCodingService", () => {
	test("startPrompt returns the provider session ref after session_initialized", async () => {
		const { codingService } = makeHarness();
		const result = await codingService.runtime.startPrompt({
			cwd: "/repo",
			prompt: "hello",
		});
		expect(result).toEqual({
			status: "accepted",
			providerId: "mock",
			sdkSessionId: "facade-session-1",
		});
	});

	test("startPrompt leaves model and effort unset when code mode has no explicit selection", async () => {
		const { codingFacade, codingService } = makeHarness();
		await codingService.runtime.startPrompt({
			cwd: "/repo",
			prompt: "use provider defaults",
		});

		expect(codingFacade.lastParams?.model).toBeUndefined();
		expect(codingFacade.lastParams?.effort).toBeUndefined();
	});

	test("startPrompt forwards explicit code mode model and effort selections", async () => {
		const { codingFacade, codingService } = makeHarness();
		await codingService.runtime.startPrompt({
			cwd: "/repo",
			prompt: "use selected code settings",
			model: "gpt-5.5",
			effort: "xhigh",
		});

		expect(codingFacade.lastParams?.model).toBe("gpt-5.5");
		expect(codingFacade.lastParams?.effort).toBe("xhigh");
	});

	test("syncs provider-backed coding session mutations through the facade", async () => {
		const facade = new ProviderSyncFacade();
		const { codingService, codingSessions, codingSharedStore } =
			makeHarness(facade);
		codingSharedStore.upsert({
			providerId: "codex",
			sdkSessionId: "known-thread",
			title: "Known session",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingSessions.upsert({
			providerId: "codex",
			sdkSessionId: "known-thread",
			cwd: "/repo",
			runStatus: "idle",
			timestamp: 100,
		});

		await codingService.archiveSession({
			providerId: "codex",
			sdkSessionId: "unknown-thread",
		});
		await codingService.restoreSession({
			providerId: "claude",
			sdkSessionId: "known-thread",
		});

		await codingService.archiveSession({
			providerId: "codex",
			sdkSessionId: "known-thread",
		});
		await codingService.restoreSession({
			providerId: "codex",
			sdkSessionId: "known-thread",
		});
		await codingService.trashSession({
			providerId: "codex",
			sdkSessionId: "known-thread",
		});
		await codingService.renameSession({
			providerId: "codex",
			sdkSessionId: "known-thread",
			title: "Known session",
		});

		expect(facade.archiveCalls).toEqual(["known-thread", "known-thread"]);
		expect(facade.restoreCalls).toEqual(["known-thread"]);
		expect(facade.renameCalls).toEqual([
			{ sessionId: "known-thread", title: "Known session" },
		]);
	});

	test("does not wire the provider push subscription", () => {
		const facade = new ProviderSyncFacade();
		makeHarness(facade);
		expect(facade.subscribeCalls).toBe(0);
	});

	test("reconciles only known provider-backed coding sessions through the facade", async () => {
		const facade = new ProviderSyncFacade();
		facade.reconcileResponses = [
			{
				sessionId: "known-thread",
				lifecycleStatus: "archived",
				title: "Archived elsewhere",
			},
			{
				sessionId: "unknown-thread",
				lifecycleStatus: "archived",
				title: "Should not import",
			},
		];
		const { codingService, codingSessions, codingSharedStore } =
			makeHarness(facade);
		codingSharedStore.upsert({
			providerId: "codex",
			sdkSessionId: "known-thread",
			title: "Original title",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingSessions.upsert({
			providerId: "codex",
			sdkSessionId: "known-thread",
			cwd: "/repo",
			runStatus: "idle",
			timestamp: 100,
		});

		await codingService.reconcileSessions({
			providerId: "codex",
			sdkSessionIds: ["unknown-thread", "known-thread", "known-thread"],
		});
		await codingService.reconcileSessions({
			providerId: "claude",
			sdkSessionIds: ["known-thread"],
		});

		expect(facade.reconcileCalls).toEqual([["known-thread"]]);
		expect(codingSessions.getDetail("codex", "known-thread")).toMatchObject({
			lifecycleStatus: "archived",
			title: "Archived elsewhere",
		});
		expect(codingSessions.getDetail("codex", "unknown-thread")).toBeUndefined();
	});

	test("reconcile does not resurrect trashed sessions, even when the provider says they are open", async () => {
		const facade = new ProviderSyncFacade();
		const { codingService, codingSessions, codingSharedStore } =
			makeHarness(facade);
		codingSharedStore.upsert({
			providerId: "codex",
			sdkSessionId: "trashed-thread",
			title: "Local title",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingSessions.upsert({
			providerId: "codex",
			sdkSessionId: "trashed-thread",
			cwd: "/repo",
			runStatus: "idle",
			timestamp: 100,
		});
		codingSessions.trash("codex", "trashed-thread");

		facade.reconcileResponses = [
			{
				sessionId: "trashed-thread",
				lifecycleStatus: "open",
				title: "Renamed in Codex",
			},
		];

		await codingService.reconcileSessions({
			providerId: "codex",
			sdkSessionIds: ["trashed-thread"],
		});

		// Lifecycle is ignored because the user deliberately trashed it; title
		// follows last-write so the new Codex name still lands locally.
		expect(codingSessions.getDetail("codex", "trashed-thread")).toMatchObject({
			lifecycleStatus: "trashed",
			title: "Renamed in Codex",
		});
	});

	test("reconcile no-ops when the provider state already matches the local state", async () => {
		const facade = new ProviderSyncFacade();
		const { codingService, codingSessions, codingSharedStore } =
			makeHarness(facade);
		codingSharedStore.upsert({
			providerId: "codex",
			sdkSessionId: "archived-thread",
			title: "Archived",
			model: "gpt-5.5",
			source: "code",
			tag: "code",
			timestamp: 100,
		});
		codingSessions.upsert({
			providerId: "codex",
			sdkSessionId: "archived-thread",
			cwd: "/repo",
			runStatus: "idle",
			timestamp: 100,
		});
		codingSessions.archive("codex", "archived-thread");
		const lastActiveBefore = codingSessions.getDetail(
			"codex",
			"archived-thread",
		)?.lastActive;

		facade.reconcileResponses = [
			{ sessionId: "archived-thread", lifecycleStatus: "archived" },
		];

		await codingService.reconcileSessions({
			providerId: "codex",
			sdkSessionIds: ["archived-thread"],
		});

		expect(codingSessions.getDetail("codex", "archived-thread")).toMatchObject({
			lifecycleStatus: "archived",
			lastActive: lastActiveBefore,
		});
	});

	test("stop() is idempotent across multiple awaiters", async () => {
		const { codingService } = makeHarness();
		const a = codingService.stop();
		const b = codingService.stop();
		expect(a).toBe(b);
		await Promise.all([a, b]);
		// A third call after settle still returns the same resolved promise.
		const c = codingService.stop();
		expect(c).toBe(a);
		await c;
	});

	test("post-stop startPrompt rejects with a shutdown message", async () => {
		const { codingService } = makeHarness();
		await codingService.stop();
		const result = await codingService.runtime.startPrompt({
			cwd: "/repo",
			prompt: "after shutdown",
		});
		expect(result).toEqual({
			status: "rejected",
			message: "Runtime shutting down",
		});
	});

	test("stop() swallows drain errors so subsequent calls resolve", async () => {
		const facade = new MockFacade();
		// Make the facade throw inside run() so the lane task rejects during drain.
		// biome-ignore lint/correctness/useYield: intentionally throws before yielding to simulate a lane failure
		facade.run = async function* errored() {
			throw new Error("boom");
		};
		const { codingService } = makeHarness(facade);
		// Kick off a prompt that will reject inside the lane.
		const inFlight = codingService.runtime.startPrompt({
			cwd: "/repo",
			prompt: "explode",
		});
		// Stop should resolve regardless of the in-flight rejection.
		await expect(codingService.stop()).resolves.toBeUndefined();
		// The inFlight promise itself should still resolve (rejected coding result),
		// not throw, since errors are surfaced through the result payload.
		await expect(inFlight).resolves.toMatchObject({ status: "rejected" });
	});

	test("rehydrateSessionEvents delegates to the coding facade for the active provider", async () => {
		const facade = new MockFacade();
		facade.providerId = "codex";
		const rehydrated: CodingSessionEvent[] = [
			{ type: "user_prompt", text: "look at jsonl", sessionId: "codex-1" },
			{ type: "thinking", text: "from jsonl", sessionId: "codex-1" },
			{ type: "text", text: "done", sessionId: "codex-1" },
		];
		facade.readCodingSessionEvents = async (sessionId: string) => {
			expect(sessionId).toBe("codex-1");
			return rehydrated;
		};
		const { codingService } = makeHarness(facade);

		await expect(
			codingService.rehydrateSessionEvents({
				providerId: "codex",
				sdkSessionId: "codex-1",
			}),
		).resolves.toEqual(rehydrated);
		await expect(
			codingService.rehydrateSessionEvents({
				providerId: "claude",
				sdkSessionId: "codex-1",
			}),
		).resolves.toEqual([]);
	});
});
