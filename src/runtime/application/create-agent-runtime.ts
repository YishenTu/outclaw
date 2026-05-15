import type { EffortLevel } from "../../common/commands.ts";
import type {
	Facade,
	FrontendNotice,
	HeartbeatResult,
	RuntimeStatusEvent,
} from "../../common/protocol.ts";
import { listWorkspaceFiles } from "../browser/files/list-workspace-files.ts";
import { type CodingRuntime, createCodingRuntime } from "../coding/index.ts";
import type { Config } from "../config/index.ts";
import type { CronJobConfig, CronRunStartResult } from "../cron/index.ts";
import { CronScheduler, createCronAgentRunner } from "../cron/index.ts";
import {
	HeartbeatScheduler,
	hasHeartbeatContent,
} from "../heartbeat/scheduler.ts";
import { startMemoryIndexWatcher } from "../memory/memory-index-watcher.ts";
import type { SessionStore } from "../persistence/session-store/session-store.ts";
import { RolloverScheduler } from "../rollover/scheduler.ts";
import { listAgentSkills } from "../skills/list-agent-skills.ts";
import type { WsClient } from "../transport/client-hub.ts";
import { createRuntimeController } from "./create-runtime-controller.ts";
import {
	type PromptProviderResolver,
	singleFacadeResolver,
} from "./prompt-execution/prompt-runner.ts";
import { SessionService } from "./session-service.ts";
import { RuntimeState } from "./state/runtime-state.ts";

/**
 * One backend chat provider available to a runtime. Composition owns the
 * facade instances; runtime modules never import provider adapters directly.
 */
export interface RuntimeProvider {
	providerId: string;
	displayName: string;
	facade: Facade;
}

interface CreateAgentRuntimeOptions {
	agentId: string;
	autoTitle?: Config["autoTitle"];
	canSendToClient?: (ws: WsClient) => boolean;
	cwd?: string;
	deliverCronResult?: (params: {
		jobName: string;
		telegramChatId: number;
		text: string;
	}) => Promise<void> | void;
	deliverHeartbeatResult?: (
		params: {
			telegramChatId: number;
		} & HeartbeatResult,
	) => Promise<void> | void;
	deliverRolloverNotice?: (params: {
		telegramChatId: number;
		text: string;
	}) => Promise<void> | void;
	defaultEffort?: EffortLevel;
	/**
	 * Primary chat facade. With single-provider runtimes this is the only
	 * facade. With multi-provider runtimes this is the default; the full
	 * provider set is supplied via `providers`/`defaultProviderId`, and
	 * `facade` MUST equal the default provider's facade.
	 */
	facade: Facade;
	/**
	 * Optional explicit provider set for multi-provider chat. When omitted,
	 * the runtime treats `facade` as the only available provider.
	 */
	providers?: ReadonlyArray<RuntimeProvider>;
	/**
	 * Optional default chat provider id. When omitted, defaults to
	 * `facade.providerId`. Must match one entry in `providers` when that
	 * argument is provided.
	 */
	defaultProviderId?: string;
	getFrontendNotice?: () => FrontendNotice | undefined;
	heartbeat?: Config["heartbeat"];
	name: string;
	promptHomeDir?: string;
	rollover?: {
		idleMinutes: number;
	};
	resolveCronTelegramChatId?: (config: CronJobConfig) => number | undefined;
	restart?: () => void;
	cronDir?: string;
	statusAgentName?: string;
	store?: SessionStore;
	coding?: CodingRuntime;
}

export interface AgentRuntime {
	agentId: string;
	askFromAgent(params: {
		fromAgentId: string;
		fromAgentName: string;
		message: string;
	}): Promise<string>;
	sendFromAgent(params: {
		fromAgentId: string;
		fromAgentName: string;
		message: string;
	}): boolean;
	currentModel: string;
	cwd?: string;
	broadcastRuntimeStatus(): void;
	getStatusEvent(): RuntimeStatusEvent;
	handleClose(ws: WsClient): void;
	handleMessage(ws: WsClient, message: string | Buffer): void;
	handleOpen(ws: WsClient): void;
	name: string;
	providerId: string;
	coding: CodingRuntime;
	getActiveSessionId(): string | undefined;
	runCronJob(params: { jobName: string }):
		| CronRunStartResult
		| {
				status: "unavailable";
				jobName: string;
		  };
	setActiveSessionChangedHandler(
		handler:
			| ((event: {
					activeSessionId?: string;
					agentId: string;
					providerId: string;
			  }) => void)
			| undefined,
	): void;
	setCronResultHandler(
		handler:
			| ((params: {
					jobName: string;
					telegramChatId: number;
					text: string;
			  }) => Promise<void> | void)
			| undefined,
	): void;
	setHeartbeatResultHandler(
		handler:
			| ((
					params: {
						telegramChatId: number;
					} & HeartbeatResult,
			  ) => Promise<void> | void)
			| undefined,
	): void;
	setSessionCatalogChangedHandler(
		handler: ((event: { agentId: string }) => void) | undefined,
	): void;
	setRolloverNoticeHandler(
		handler:
			| ((params: {
					telegramChatId: number;
					text: string;
			  }) => Promise<void> | void)
			| undefined,
	): void;
	stop(): Promise<void>;
}

export function createAgentRuntime(
	options: CreateAgentRuntimeOptions,
): AgentRuntime {
	const facade = options.facade;
	const providerResolver = buildProviderResolver(options);
	let activeSessionChanged:
		| ((event: {
				activeSessionId?: string;
				agentId: string;
				providerId: string;
		  }) => void)
		| undefined;
	let sessionCatalogChanged: ((event: { agentId: string }) => void) | undefined;
	const state = new RuntimeState(
		facade.providerId,
		options.statusAgentName ?? options.name,
		{ defaultEffort: options.defaultEffort },
	);
	let noteRolloverStateChange = () => {};
	const sessions = new SessionService(state, options.store, {
		onAcceptedInteractivePrompt: () => noteRolloverStateChange(),
		onActiveSessionChanged: (event) =>
			activeSessionChanged?.({
				...event,
				agentId: options.agentId,
			}),
		onSessionCatalogChanged: () =>
			sessionCatalogChanged?.({ agentId: options.agentId }),
		onSessionStateChange: () => noteRolloverStateChange(),
	});
	const workspaceCwd = options.cwd;
	const promptHomeDir = options.promptHomeDir;
	const controller = createRuntimeController({
		agentId: options.agentId,
		autoTitle: options.autoTitle,
		canSendToClient: options.canSendToClient,
		cwd: options.cwd,
		facade,
		providers: providerResolver,
		getFrontendNotice: options.getFrontendNotice,
		listSkills: promptHomeDir
			? () => listAgentSkills(promptHomeDir)
			: undefined,
		listWorkspaceFiles: workspaceCwd
			? () => listWorkspaceFiles(workspaceCwd)
			: undefined,
		onExecutionStateChange: () => noteRolloverStateChange(),
		restart: options.restart,
		deliverCronResult: options.deliverCronResult,
		deliverHeartbeatResult: options.deliverHeartbeatResult,
		deliverRolloverNotice: options.deliverRolloverNotice,
		promptHomeDir,
		sessions,
		state,
		store: options.store,
	});
	const coding = options.coding ?? createUnconfiguredCodingRuntime();
	const heartbeat =
		promptHomeDir && options.heartbeat
			? new HeartbeatScheduler({
					config: options.heartbeat,
					promptHomeDir,
					hasHeartbeatContent: () => hasHeartbeatContent(promptHomeDir),
					onDeferred: (deferMinutes) =>
						controller.startDeferTimer(deferMinutes),
					onStatusChange: () => controller.broadcastRuntimeStatus(),
					shouldAttemptHeartbeat: (scheduledAt, deferMinutes) =>
						controller.shouldAttemptHeartbeat(scheduledAt, deferMinutes),
					requestHeartbeat: (prompt, scheduledAt, deferMinutes) =>
						controller.enqueueHeartbeat(prompt, scheduledAt, deferMinutes),
				})
			: undefined;
	if (heartbeat) {
		controller.setHeartbeatInfoProvider(() => ({
			nextHeartbeatAt: heartbeat.nextHeartbeatAt,
			deferred: heartbeat.deferred,
		}));
		controller.setFireDeferredHeartbeat(() => heartbeat.fireDeferred());
	}
	const rollover = options.rollover
		? new RolloverScheduler({
				config: options.rollover,
				getLastHandledInteractiveAt: () =>
					sessions.getLastHandledRolloverInteractiveAt(),
				getLastInteractiveAt: () => sessions.getLastInteractiveAt(),
				hasActiveRun: () => controller.hasVisibleRun,
				hasActiveSession: () => sessions.activeSessionId !== undefined,
				requestRollover: (prompt) =>
					controller.enqueueRollover(
						prompt,
						options.rollover?.idleMinutes ?? 0,
					),
			})
		: undefined;
	noteRolloverStateChange = () => rollover?.noteStateChanged();

	const cronScheduler =
		options.cronDir && options.promptHomeDir
			? new CronScheduler({
					cronDir: options.cronDir,
					runAgent: createCronAgentRunner({
						providers: providerResolver,
						promptHomeDir: options.promptHomeDir,
						cwd: options.cwd ?? process.cwd(),
					}),
					onResult: (event) => controller.broadcastCronResult(event),
					getDefaultEffort: () => state.defaultEffort,
					resolveTelegramChatId: options.resolveCronTelegramChatId,
				})
			: undefined;

	heartbeat?.start();
	rollover?.start();
	cronScheduler?.start();
	const memoryIndexWatcher = options.promptHomeDir
		? startMemoryIndexWatcher({
				memoryRoot: options.promptHomeDir,
			})
		: undefined;
	let stopPromise: Promise<void> | undefined;

	return {
		agentId: options.agentId,
		askFromAgent: controller.askFromAgent.bind(controller),
		sendFromAgent: controller.sendFromAgent.bind(controller),
		cwd: options.cwd,
		get currentModel() {
			return controller.currentModel;
		},
		get providerId() {
			return controller.getStatusEvent().providerId ?? facade.providerId;
		},
		getStatusEvent() {
			return controller.getStatusEvent();
		},
		broadcastRuntimeStatus() {
			controller.broadcastRuntimeStatus();
		},
		handleClose: controller.handleClose,
		handleMessage: controller.handleMessage,
		handleOpen: controller.handleOpen,
		name: options.name,
		coding,
		getActiveSessionId() {
			return sessions.activeSessionId;
		},
		runCronJob(params) {
			if (!cronScheduler) {
				return {
					status: "unavailable",
					jobName: params.jobName,
				};
			}
			return cronScheduler.startJob(params.jobName);
		},
		setActiveSessionChangedHandler(handler) {
			activeSessionChanged = handler;
		},
		setCronResultHandler(handler) {
			controller.setCronResultHandler(handler);
		},
		setHeartbeatResultHandler(handler) {
			controller.setHeartbeatResultHandler(handler);
		},
		setSessionCatalogChangedHandler(handler) {
			sessionCatalogChanged = handler;
		},
		setRolloverNoticeHandler(handler) {
			controller.setRolloverNoticeHandler(handler);
		},
		stop() {
			if (!stopPromise) {
				stopPromise = (async () => {
					cronScheduler?.stop();
					heartbeat?.stop();
					rollover?.stop();
					memoryIndexWatcher?.stop();
					controller.beginShutdown();
					await controller.drain();
				})();
			}
			return stopPromise;
		},
	};
}

function buildProviderResolver(
	options: CreateAgentRuntimeOptions,
): PromptProviderResolver {
	if (!options.providers || options.providers.length === 0) {
		// Single-provider runtime: every providerId resolves to the same
		// facade. Auto-title and cron routing infer a provider id from the
		// model id (`claude` vs `codex`); when the caller wired only one
		// facade there is no ambiguity to police, and rejecting the
		// inferred id would crash on every Claude alias whose facade
		// happens to advertise a different providerId (e.g. test mocks).
		return singleFacadeResolver(options.facade);
	}
	const byId = new Map(
		options.providers.map((provider) => [provider.providerId, provider.facade]),
	);
	const defaultProviderId =
		options.defaultProviderId ?? options.facade.providerId;
	if (!byId.has(defaultProviderId)) {
		throw new Error(
			`Default provider ${defaultProviderId} is not present in the runtime provider set`,
		);
	}
	if (!byId.has(options.facade.providerId)) {
		throw new Error(
			`Primary facade providerId ${options.facade.providerId} must be one of the configured providers`,
		);
	}
	return {
		getFacade: (providerId: string) => {
			const found = byId.get(providerId);
			if (!found) {
				throw new Error(
					`Provider ${providerId} is not configured in this runtime`,
				);
			}
			return found;
		},
	};
}

function createUnconfiguredCodingRuntime(): CodingRuntime {
	return createCodingRuntime({
		providerId: "unconfigured",
		runDetachedPrompt() {
			return {
				status: "rejected" as const,
				message: "Coding service is not configured for this runtime",
			};
		},
	});
}
