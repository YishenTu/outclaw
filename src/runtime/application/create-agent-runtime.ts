import type {
	Facade,
	HeartbeatResult,
	RuntimeStatusEvent,
} from "../../common/protocol.ts";
import type { Config } from "../config.ts";
import type { CronJobConfig } from "../cron/index.ts";
import { CronScheduler, createCronAgentRunner } from "../cron/index.ts";
import {
	HeartbeatScheduler,
	hasHeartbeatContent,
} from "../heartbeat/scheduler.ts";
import type { SessionStore } from "../persistence/session-store.ts";
import type { WsClient } from "../transport/client-hub.ts";
import { createRuntimeController } from "./create-runtime-controller.ts";
import { RuntimeState } from "./runtime-state.ts";
import { SessionService } from "./session-service.ts";

interface CreateAgentRuntimeOptions {
	agentId: string;
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
	facade: Facade;
	heartbeat?: Config["heartbeat"];
	name: string;
	promptHomeDir?: string;
	resolveCronTelegramChatId?: (config: CronJobConfig) => number | undefined;
	restart?: () => void;
	cronDir?: string;
	statusAgentName?: string;
	store?: SessionStore;
}

export interface AgentRuntime {
	agentId: string;
	askFromAgent(params: {
		fromAgentId: string;
		fromAgentName: string;
		message: string;
	}): Promise<string>;
	currentModel: string;
	getStatusEvent(): RuntimeStatusEvent;
	handleClose(ws: WsClient): void;
	handleMessage(ws: WsClient, message: string | Buffer): void;
	handleOpen(ws: WsClient): void;
	name: string;
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
	stop(): Promise<void>;
}

export function createAgentRuntime(
	options: CreateAgentRuntimeOptions,
): AgentRuntime {
	const facade = options.facade;
	const state = new RuntimeState(
		facade.providerId,
		options.statusAgentName ?? options.name,
	);
	const sessions = new SessionService(state, options.store);
	const controller = createRuntimeController({
		canSendToClient: options.canSendToClient,
		cwd: options.cwd,
		facade,
		restart: options.restart,
		deliverCronResult: options.deliverCronResult,
		deliverHeartbeatResult: options.deliverHeartbeatResult,
		promptHomeDir: options.promptHomeDir,
		sessions,
		state,
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
					resolveTelegramChatId: options.resolveCronTelegramChatId,
				})
			: undefined;

	heartbeat?.start();
	cronScheduler?.start();
	let stopPromise: Promise<void> | undefined;

	return {
		agentId: options.agentId,
		askFromAgent: controller.askFromAgent.bind(controller),
		get currentModel() {
			return controller.currentModel;
		},
		getStatusEvent() {
			return controller.getStatusEvent();
		},
		handleClose: controller.handleClose,
		handleMessage: controller.handleMessage,
		handleOpen: controller.handleOpen,
		name: options.name,
		setCronResultHandler(handler) {
			controller.setCronResultHandler(handler);
		},
		setHeartbeatResultHandler(handler) {
			controller.setHeartbeatResultHandler(handler);
		},
		stop() {
			if (!stopPromise) {
				stopPromise = (async () => {
					cronScheduler?.stop();
					heartbeat?.stop();
					controller.beginShutdown();
					await controller.drain();
				})();
			}
			return stopPromise;
		},
	};
}
