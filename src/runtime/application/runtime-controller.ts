import type {
	HeartbeatResult,
	RuntimeStatusEvent,
} from "../../common/protocol.ts";
import type { WsClient } from "../transport/client-hub.ts";
import type { RuntimeClientGateway } from "./runtime-client-gateway.ts";
import type { RuntimeCronBroadcaster } from "./runtime-cron-broadcaster.ts";
import type { RuntimeExecutionCoordinator } from "./runtime-execution-coordinator.ts";
import type { RuntimeMessageRouter } from "./runtime-message-router.ts";
import type { RuntimeState } from "./runtime-state.ts";

interface RuntimeControllerOptions {
	clients: RuntimeClientGateway;
	cronBroadcaster: RuntimeCronBroadcaster;
	execution: RuntimeExecutionCoordinator;
	heartbeatInfoProvider?: () => {
		nextHeartbeatAt: number | undefined;
		deferred: boolean;
	};
	messageRouter: RuntimeMessageRouter;
	promptDispatcher: {
		setHeartbeatResultHandler: (
			handler:
				| ((
						params: {
							telegramChatId: number;
						} & HeartbeatResult,
				  ) => Promise<void> | void)
				| undefined,
		) => void;
	};
	state: RuntimeState;
}

export class RuntimeController {
	private clients: RuntimeClientGateway;
	private cronBroadcaster: RuntimeCronBroadcaster;
	private execution: RuntimeExecutionCoordinator;
	private heartbeatInfoProvider:
		| RuntimeControllerOptions["heartbeatInfoProvider"]
		| undefined;
	private messageRouter: RuntimeMessageRouter;
	private promptDispatcher: RuntimeControllerOptions["promptDispatcher"];
	private state: RuntimeState;

	constructor(options: RuntimeControllerOptions) {
		this.clients = options.clients;
		this.cronBroadcaster = options.cronBroadcaster;
		this.execution = options.execution;
		this.heartbeatInfoProvider = options.heartbeatInfoProvider;
		this.messageRouter = options.messageRouter;
		this.promptDispatcher = options.promptDispatcher;
		this.state = options.state;
	}

	get currentModel(): string {
		return this.state.model;
	}

	getStatusEvent(): RuntimeStatusEvent {
		return this.createStatusEvent();
	}

	setHeartbeatInfoProvider(
		provider: () => { nextHeartbeatAt: number | undefined; deferred: boolean },
	) {
		this.heartbeatInfoProvider = provider;
	}

	setFireDeferredHeartbeat(handler: () => Promise<void> | void) {
		this.execution.setFireDeferredHeartbeat(handler);
	}

	startDeferTimer(deferMinutes: number) {
		this.execution.startDeferTimer(deferMinutes);
	}

	async broadcastCronResult(result: {
		jobName: string;
		model: string;
		sessionId?: string;
		text: string;
	}) {
		await this.cronBroadcaster.broadcastResult(result);
	}

	setCronResultHandler(
		handler:
			| ((params: {
					jobName: string;
					telegramChatId: number;
					text: string;
			  }) => Promise<void> | void)
			| undefined,
	) {
		this.cronBroadcaster.setHandler(handler);
	}

	setHeartbeatResultHandler(
		handler:
			| ((
					params: {
						telegramChatId: number;
					} & HeartbeatResult,
			  ) => Promise<void> | void)
			| undefined,
	) {
		this.promptDispatcher.setHeartbeatResultHandler(handler);
	}

	handleClose = (ws: WsClient) => {
		this.clients.handleClose(ws);
	};

	handleMessage = (ws: WsClient, message: string | Buffer) => {
		this.messageRouter.handleMessage(ws, message);
	};

	handleOpen = (ws: WsClient) => {
		this.clients.handleOpen(ws);
	};

	beginShutdown() {
		this.execution.beginShutdown();
	}

	drain(): Promise<void> {
		return this.execution.drain();
	}

	broadcastRuntimeStatus() {
		this.clients.broadcastStatus();
	}

	private createStatusEvent(): RuntimeStatusEvent {
		const event = this.state.createStatusEvent();
		if (!event.sessionId) {
			return event;
		}

		const info = this.heartbeatInfoProvider?.();
		if (info?.nextHeartbeatAt !== undefined) {
			event.nextHeartbeatAt = info.nextHeartbeatAt;
		}
		if (info?.deferred) {
			event.heartbeatDeferred = true;
		}
		return event;
	}

	enqueueHeartbeat(
		prompt: string,
		scheduledAt: number,
		deferMinutes: number,
	): boolean {
		return this.execution.enqueueHeartbeat(prompt, scheduledAt, deferMinutes);
	}

	shouldAttemptHeartbeat(
		scheduledAt: number,
		deferMinutes: number,
	): "attempt" | "skip" | "defer" {
		return this.execution.shouldAttemptHeartbeat(scheduledAt, deferMinutes);
	}

	askFromAgent(params: {
		fromAgentId: string;
		fromAgentName: string;
		message: string;
	}): Promise<string> {
		return this.execution.enqueueAgentPrompt({
			source: "agent",
			agentMessage: {
				fromAgentId: params.fromAgentId,
				fromAgentName: params.fromAgentName,
			},
			prompt: `[from agent "${params.fromAgentName}"]\n${params.message}`,
		});
	}
}
