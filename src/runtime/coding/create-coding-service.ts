import {
	type CodingSessionEvent,
	extractError,
	type Facade,
	type ProviderCodingSessionUpdate,
	type ProviderModelInfo,
	type ProviderSkillInfo,
} from "../../common/protocol.ts";
import { createRuntimeController } from "../application/create-runtime-controller.ts";
import { SessionService } from "../application/session-service.ts";
import { RuntimeState } from "../application/state/runtime-state.ts";
import type { SessionStore } from "../persistence/session-store/session-store.ts";
import type { CodingRepositoryStore } from "./coding-repository-store.ts";
import { type CodingRuntime, createCodingRuntime } from "./coding-runtime.ts";
import type { CodingSessionEventRecorder } from "./coding-session-event-hub.ts";
import type { CodingSessionStore } from "./coding-session-store.ts";
import { CODING_STORAGE_OWNER_ID } from "./coding-session-store.ts";

interface CreateCodingServiceOptions {
	facade: Facade;
	repositories: CodingRepositoryStore;
	sessions: CodingSessionStore;
	events: CodingSessionEventRecorder;
	sharedSessionStore: SessionStore;
}

export interface CodingService {
	readonly runtime: CodingRuntime;
	archiveSession(params: {
		providerId: string;
		sdkSessionId: string;
	}): Promise<void>;
	trashSession(params: {
		providerId: string;
		sdkSessionId: string;
	}): Promise<void>;
	listModels(): Promise<ProviderModelInfo[]>;
	listSkills(params: {
		cwd: string;
		forceReload?: boolean;
	}): Promise<ProviderSkillInfo[]>;
	renameSession(params: {
		providerId: string;
		sdkSessionId: string;
		title: string;
	}): Promise<void>;
	reconcileSessions(params: {
		providerId: string;
		sdkSessionIds: string[];
	}): Promise<void>;
	rehydrateSessionEvents(params: {
		providerId: string;
		sdkSessionId: string;
	}): Promise<CodingSessionEvent[]>;
	restoreSession(params: {
		providerId: string;
		sdkSessionId: string;
	}): Promise<void>;
	stop(): Promise<void>;
}

export function createCodingService(
	opts: CreateCodingServiceOptions,
): CodingService {
	const state = new RuntimeState(opts.facade.providerId, "coding");
	const sessions = new SessionService(state, opts.sharedSessionStore);
	const controller = createRuntimeController({
		agentId: CODING_STORAGE_OWNER_ID,
		facade: opts.facade,
		sessions,
		state,
	});
	const runtime = createCodingRuntime({
		codingEvents: opts.events,
		codingRepositories: opts.repositories,
		codingSessions: opts.sessions,
		providerId: opts.facade.providerId,
		runDetachedPrompt: controller.runDetachedPrompt.bind(controller),
		...(opts.facade.steerCodingSession
			? {
					steerActivePrompt: async (params) => {
						await opts.facade.steerCodingSession?.({
							sessionId: params.sdkSessionId,
							prompt: params.prompt,
							cwd: params.cwd,
						});
					},
				}
			: {}),
	});
	// We intentionally do NOT subscribe to `subscribeCodingSessionUpdates`. The
	// provider push has proven unreliable in practice, and a partially-delivered
	// stream would silently mutate local lifecycle state outside the precedence
	// rules in `syncKnownCodingSessionUpdate`. Inbound sync now flows only
	// through `reconcileCodingSessions`, which we trigger lazily on user
	// attention.
	let stopPromise: Promise<void> | undefined;
	return {
		runtime,
		async archiveSession(params) {
			if (!isKnownFacadeCodingSession(opts, params)) {
				return;
			}
			await opts.facade.archiveCodingSession?.(params.sdkSessionId);
		},
		async trashSession(params) {
			// Trash is a local-only state that Codex does not model, so we mirror
			// it outbound as `archive` — the precedence table in
			// `syncKnownCodingSessionUpdate` keeps a stale Codex `open` echo from
			// resurrecting trashed work.
			if (!isKnownFacadeCodingSession(opts, params)) {
				return;
			}
			await opts.facade.archiveCodingSession?.(params.sdkSessionId);
		},
		async listModels() {
			return (await opts.facade.listModels?.()) ?? [];
		},
		async listSkills(params) {
			return (await opts.facade.listProviderSkills?.(params)) ?? [];
		},
		async renameSession(params) {
			if (!isKnownFacadeCodingSession(opts, params)) {
				return;
			}
			await opts.facade.renameCodingSession?.(
				params.sdkSessionId,
				params.title,
			);
		},
		async reconcileSessions(params) {
			if (params.providerId !== opts.facade.providerId) {
				return;
			}
			const knownSessionIds = uniqueSessionIds(params.sdkSessionIds).filter(
				(sessionId) => !!opts.sessions.get(params.providerId, sessionId),
			);
			if (knownSessionIds.length === 0) {
				return;
			}
			const updates =
				(await opts.facade.reconcileCodingSessions?.(knownSessionIds)) ?? [];
			for (const update of updates) {
				syncKnownCodingSessionUpdate(opts, update);
			}
		},
		async rehydrateSessionEvents(params) {
			if (params.providerId !== opts.facade.providerId) {
				return [];
			}
			return (
				(await opts.facade.readCodingSessionEvents?.(params.sdkSessionId)) ?? []
			);
		},
		async restoreSession(params) {
			if (!isKnownFacadeCodingSession(opts, params)) {
				return;
			}
			await opts.facade.restoreCodingSession?.(params.sdkSessionId);
		},
		stop() {
			if (!stopPromise) {
				stopPromise = (async () => {
					try {
						controller.beginShutdown();
						await controller.drain();
					} catch (err) {
						// Swallow drain errors so repeated stop() calls and the wider
						// daemon shutdown sequence never see a rejected promise. The
						// caller has already requested shutdown; surfacing failures here
						// only prevents subsequent stores from closing.
						console.error(
							`Coding service shutdown failed: ${extractError(err)}`,
						);
					}
				})();
			}
			return stopPromise;
		},
	};
}

function uniqueSessionIds(sessionIds: string[]): string[] {
	return [...new Set(sessionIds.map((sessionId) => sessionId.trim()))].filter(
		Boolean,
	);
}

function isKnownFacadeCodingSession(
	opts: CreateCodingServiceOptions,
	params: { providerId: string; sdkSessionId: string },
): boolean {
	return (
		params.providerId === opts.facade.providerId &&
		!!opts.sessions.get(params.providerId, params.sdkSessionId)
	);
}

/**
 * Merges a provider lifecycle update into the local catalog. The provider
 * vocabulary is binary (`open | archived`); we model `trashed` locally and
 * never accept a remote `open` for a trashed session — that path is how a
 * stale Codex view would resurrect work the user has explicitly thrown away.
 *
 * | local      | provider archived | provider open |
 * |------------|-------------------|---------------|
 * | open       | -> archived       | no-op         |
 * | archived   | no-op             | -> open unless repo-cascaded |
 * | trashed    | no-op             | ignore        |
 *
 * Titles always reflect last-write, regardless of lifecycle state.
 */
function syncKnownCodingSessionUpdate(
	opts: CreateCodingServiceOptions,
	update: ProviderCodingSessionUpdate,
) {
	const providerId = opts.facade.providerId;
	const session = opts.sessions.get(providerId, update.sessionId);
	if (!session) {
		return;
	}

	if (update.lifecycleStatus === "archived") {
		if (session.lifecycleStatus === "open") {
			opts.sessions.archive(providerId, update.sessionId);
		}
	} else if (update.lifecycleStatus === "open") {
		if (session.lifecycleStatus === "archived" && !session.cascadedFromRepo) {
			opts.sessions.restore(providerId, update.sessionId);
		}
	}

	const title = update.title?.trim();
	if (title) {
		opts.sessions.rename(providerId, update.sessionId, title);
	}
}
