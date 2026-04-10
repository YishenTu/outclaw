import { ClaudeAdapter } from "../../backend/adapters/claude.ts";
import type {
	Facade,
	HeartbeatResult,
	HistoryReplayEvent,
	RuntimeClientType,
} from "../../common/protocol.ts";
import { RuntimeController } from "../application/runtime-controller.ts";
import type { Config } from "../config.ts";
import { CronScheduler, createCronAgentRunner } from "../cron/index.ts";
import {
	HeartbeatScheduler,
	hasHeartbeatContent,
} from "../heartbeat/scheduler.ts";
import { readHistory } from "../persistence/history-reader.ts";
import type { SessionStore } from "../persistence/session-store.ts";

interface RuntimeOptions {
	port: number;
	facade?: Facade;
	cwd?: string;
	cronDir?: string;
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
	promptHomeDir?: string;
	heartbeat?: Config["heartbeat"];
	historyReader?: (
		sdkSessionId: string,
	) => Promise<HistoryReplayEvent["messages"]>;
	store?: SessionStore;
}

export function createRuntime(options: RuntimeOptions) {
	const facade = options.facade ?? new ClaudeAdapter();
	const controller = new RuntimeController({
		cwd: options.cwd,
		promptHomeDir: options.promptHomeDir,
		facade,
		deliverCronResult: options.deliverCronResult,
		deliverHeartbeatResult: options.deliverHeartbeatResult,
		historyReader: options.historyReader ?? readHistory,
		store: options.store,
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
				})
			: undefined;

	const server = Bun.serve<{ clientType: RuntimeClientType }>({
		port: options.port,
		fetch(req, server) {
			const clientType = resolveClientType(req.url);
			if (server.upgrade(req, { data: { clientType } })) {
				return;
			}
			return new Response("outclaw runtime", { status: 200 });
		},
		websocket: {
			close: controller.handleClose,
			message: controller.handleMessage,
			open: controller.handleOpen,
		},
	});
	heartbeat?.start();
	cronScheduler?.start();
	let stopPromise: Promise<void> | undefined;

	return {
		port: server.port as number,
		setCronResultHandler(handler: RuntimeOptions["deliverCronResult"]) {
			controller.setCronResultHandler(handler);
		},
		setHeartbeatResultHandler(
			handler: RuntimeOptions["deliverHeartbeatResult"],
		) {
			controller.setHeartbeatResultHandler(handler);
		},
		stop() {
			if (!stopPromise) {
				stopPromise = (async () => {
					cronScheduler?.stop();
					heartbeat?.stop();
					controller.beginShutdown();
					await controller.drain();
					server.stop();
				})();
			}
			return stopPromise;
		},
	};
}

function resolveClientType(url: string): RuntimeClientType {
	const client = new URL(url).searchParams.get("client");
	return client === "telegram" ? "telegram" : "tui";
}
