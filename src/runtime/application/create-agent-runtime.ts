import type { EffortLevel } from "../../common/commands.ts";
import type {
	Facade,
	FrontendNotice,
	HeartbeatResult,
	RuntimeStatusEvent,
} from "../../common/protocol.ts";
import { listWorkspaceFiles } from "../browser/files/list-workspace-files.ts";
import {
	type CodingRepositoryRegistrar,
	type CodingRuntime,
	type CodingSessionRecorder,
	createCodingRuntime,
} from "../coding/index.ts";
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
import type { WsClient } from "../transport/client-hub.ts";
import { createRuntimeController } from "./create-runtime-controller.ts";
import { SessionService } from "./session-service.ts";
import { RuntimeState } from "./state/runtime-state.ts";

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
	facade: Facade;
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
	codingFacade?: Facade;
	codingRepositories?: CodingRepositoryRegistrar;
	codingSessions?: CodingSessionRecorder;
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
	const controller = createRuntimeController({
		agentId: options.agentId,
		autoTitle: options.autoTitle,
		canSendToClient: options.canSendToClient,
		cwd: options.cwd,
		facade,
		getFrontendNotice: options.getFrontendNotice,
		listWorkspaceFiles: workspaceCwd
			? () => listWorkspaceFiles(workspaceCwd)
			: undefined,
		onExecutionStateChange: () => noteRolloverStateChange(),
		restart: options.restart,
		deliverCronResult: options.deliverCronResult,
		deliverHeartbeatResult: options.deliverHeartbeatResult,
		deliverRolloverNotice: options.deliverRolloverNotice,
		promptHomeDir: options.promptHomeDir,
		sessions,
		state,
	});
	const codingFacade = options.codingFacade ?? facade;
	const codingState =
		codingFacade === facade
			? state
			: new RuntimeState(
					codingFacade.providerId,
					options.statusAgentName ?? options.name,
					{ defaultEffort: options.defaultEffort },
				);
	const codingSessionService =
		codingFacade === facade
			? sessions
			: new SessionService(codingState, options.store, {
					onSessionCatalogChanged: () =>
						sessionCatalogChanged?.({ agentId: options.agentId }),
				});
	const codingController =
		codingFacade === facade
			? controller
			: createRuntimeController({
					agentId: options.agentId,
					canSendToClient: options.canSendToClient,
					cwd: options.cwd,
					facade: codingFacade,
					onExecutionStateChange: () => noteRolloverStateChange(),
					promptHomeDir: options.promptHomeDir,
					sessions: codingSessionService,
					state: codingState,
				});
	const coding = createCodingRuntime({
		codingRepositories: options.codingRepositories,
		codingSessions: options.codingSessions,
		defaultAgentId: options.agentId,
		getLinkedChatSession: () =>
			sessions.activeSessionId
				? {
						agentId: options.agentId,
						providerId: sessions.providerId,
						sessionId: sessions.activeSessionId,
					}
				: undefined,
		providerId: codingFacade.providerId,
		runDetachedPrompt:
			codingController.runDetachedPrompt.bind(codingController),
	});
	const promptHomeDir = options.promptHomeDir;
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
						facade,
						promptHomeDir: options.promptHomeDir,
						cwd: options.cwd ?? process.cwd(),
					}),
					onResult: (event) => controller.broadcastCronResult(event),
					getDefaultModel: () => controller.currentModel,
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
			return facade.providerId;
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
					if (codingController !== controller) {
						codingController.beginShutdown();
					}
					await Promise.all([
						controller.drain(),
						codingController === controller
							? Promise.resolve()
							: codingController.drain(),
					]);
				})();
			}
			return stopPromise;
		},
	};
}
