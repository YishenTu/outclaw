import type { Facade, HeartbeatResult } from "../../common/protocol.ts";
import type { WsClient } from "../transport/client-hub.ts";
import { PromptDispatcher } from "./prompt-dispatcher.ts";
import { PromptRunner } from "./prompt-runner.ts";
import { RuntimeClientGateway } from "./runtime-client-gateway.ts";
import { RuntimeControlPlane } from "./runtime-control-plane.ts";
import { RuntimeController } from "./runtime-controller.ts";
import { RuntimeCronBroadcaster } from "./runtime-cron-broadcaster.ts";
import { RuntimeExecutionCoordinator } from "./runtime-execution-coordinator.ts";
import { RuntimeMessageRouter } from "./runtime-message-router.ts";
import type { RuntimeState } from "./runtime-state.ts";
import type { SessionService } from "./session-service.ts";

interface CreateRuntimeControllerOptions {
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
	promptHomeDir?: string;
	restart?: () => void;
	sessions: SessionService;
	state: RuntimeState;
}

export function createRuntimeController(
	options: CreateRuntimeControllerOptions,
) {
	// Safe during construction: collaborators only invoke this after the
	// controller has been fully assembled, when heartbeat-enriched status is ready.
	let getStatusEvent = () => options.state.createStatusEvent();
	const clients = new RuntimeClientGateway({
		canSendToClient: options.canSendToClient,
		cwd: options.cwd,
		facade: options.facade,
		getStatusEvent: () => getStatusEvent(),
	});
	const promptRunner = new PromptRunner({
		cwd: options.cwd,
		facade: options.facade,
		promptHomeDir: options.promptHomeDir,
	});
	const promptDispatcher = new PromptDispatcher({
		clients,
		deliverHeartbeatResult: options.deliverHeartbeatResult,
		promptRunner,
		sessions: options.sessions,
		state: options.state,
	});
	const execution = new RuntimeExecutionCoordinator({
		promptDispatcher,
		state: options.state,
	});
	const controlPlane = new RuntimeControlPlane({
		clients,
		createStatusEvent: () => getStatusEvent(),
		execution,
		restart: options.restart,
		sessions: options.sessions,
		state: options.state,
	});
	const cronBroadcaster = new RuntimeCronBroadcaster({
		clients,
		deliverCronResult: options.deliverCronResult,
		sessions: options.sessions,
	});
	const messageRouter = new RuntimeMessageRouter({
		clients,
		controlPlane,
		execution,
	});

	const controller = new RuntimeController({
		clients,
		cronBroadcaster,
		execution,
		messageRouter,
		promptDispatcher,
		state: options.state,
	});
	getStatusEvent = () => controller.getStatusEvent();
	return controller;
}
