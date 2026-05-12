import {
	type CodingSessionEvent,
	extractError,
	type Facade,
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
	listModels(): Promise<ProviderModelInfo[]>;
	listSkills(params: {
		cwd: string;
		forceReload?: boolean;
	}): Promise<ProviderSkillInfo[]>;
	rehydrateSessionEvents(params: {
		providerId: string;
		sdkSessionId: string;
	}): Promise<CodingSessionEvent[]>;
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
	});
	let stopPromise: Promise<void> | undefined;
	return {
		runtime,
		async listModels() {
			return (await opts.facade.listModels?.()) ?? [];
		},
		async listSkills(params) {
			return (await opts.facade.listProviderSkills?.(params)) ?? [];
		},
		async rehydrateSessionEvents(params) {
			if (params.providerId !== opts.facade.providerId) {
				return [];
			}
			return (
				(await opts.facade.readCodingSessionEvents?.(params.sdkSessionId)) ?? []
			);
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
