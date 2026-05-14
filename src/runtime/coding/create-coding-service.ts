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
	const unsubscribeProviderUpdates =
		opts.facade.subscribeCodingSessionUpdates?.((update) => {
			syncKnownCodingSessionUpdate(opts, update);
		});
	let stopPromise: Promise<void> | undefined;
	return {
		runtime,
		async archiveSession(params) {
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
						unsubscribeProviderUpdates?.();
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
		opts.sessions.archive(providerId, update.sessionId);
	} else if (update.lifecycleStatus === "open") {
		opts.sessions.restore(providerId, update.sessionId);
	}

	const title = update.title?.trim();
	if (title) {
		opts.sessions.rename(providerId, update.sessionId, title);
	}
}
