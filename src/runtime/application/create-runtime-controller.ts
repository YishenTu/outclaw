import type {
	Facade,
	FrontendNotice,
	HeartbeatResult,
	WorkspaceFileEntry,
} from "../../common/protocol.ts";
import type { WsClient } from "../transport/client-hub.ts";
import { AutoTitleCoordinator } from "./auto-title.ts";
import { RuntimeClientGateway } from "./gateway/runtime-client-gateway.ts";
import { RuntimeMessageRouter } from "./gateway/runtime-message-router.ts";
import { PromptDispatcher } from "./prompt-execution/prompt-dispatcher.ts";
import { PromptRunner } from "./prompt-execution/prompt-runner.ts";
import { StreamingStateStore } from "./prompt-execution/streaming-state-store.ts";
import { RuntimeControlPlane } from "./runtime-control-plane.ts";
import { RuntimeController } from "./runtime-controller.ts";
import { RuntimeCronBroadcaster } from "./runtime-cron-broadcaster.ts";
import { RuntimeExecutionCoordinator } from "./runtime-execution-coordinator.ts";
import type { SessionService } from "./session-service.ts";
import type { RuntimeState } from "./state/runtime-state.ts";

interface CreateRuntimeControllerOptions {
	agentId?: string;
	autoTitle?: {
		model: string;
	};
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
	facade: Facade;
	getFrontendNotice?: () => FrontendNotice | undefined;
	listWorkspaceFiles?: () => Promise<WorkspaceFileEntry[]>;
	onExecutionStateChange?: () => void;
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
	const streamingState = new StreamingStateStore();
	const clients = new RuntimeClientGateway({
		canSendToClient: options.canSendToClient,
		cwd: options.cwd,
		facade: options.facade,
		listWorkspaceFiles: options.listWorkspaceFiles,
		getStreamingSyncEvent: (sessionId) => {
			const snapshot = streamingState.get(sessionId);
			if (
				!snapshot ||
				(snapshot.text === "" &&
					snapshot.thinking === "" &&
					snapshot.images.length === 0)
			) {
				return undefined;
			}

			return {
				type: "streaming_sync",
				sdkSessionId: sessionId,
				images: snapshot.images,
				text: snapshot.text,
				thinking: snapshot.thinking,
			};
		},
		getStatusEvent: () => getStatusEvent(),
	});
	const promptRunner = new PromptRunner({
		cwd: options.cwd,
		facade: options.facade,
		promptHomeDir: options.promptHomeDir,
	});
	options.sessions.configureCallbacks({
		onSessionRenamed: (event) => {
			clients.broadcast(event);
			clients.broadcastStatus();
		},
	});
	const autoTitle = options.autoTitle
		? new AutoTitleCoordinator({
				cwd: options.cwd,
				facade: options.facade,
				model: options.autoTitle.model,
				sessions: options.sessions,
			})
		: undefined;
	const promptDispatcher = new PromptDispatcher({
		clients,
		deliverHeartbeatResult: options.deliverHeartbeatResult,
		onVisibleRunStarted: () => clients.broadcastStatus(),
		promptRunner,
		readTranscript: options.facade.readTranscript?.bind(options.facade),
		sessions: options.sessions,
		state: options.state,
		streamingState,
	});
	const execution = new RuntimeExecutionCoordinator({
		autoTitle,
		deliverRolloverNotice: options.deliverRolloverNotice,
		onStatusChange: () => {
			clients.broadcastStatus();
			options.onExecutionStateChange?.();
		},
		promptDispatcher,
		sessions: options.sessions,
		state: options.state,
	});
	const controlPlane = new RuntimeControlPlane({
		clients,
		createStatusEvent: () => getStatusEvent(),
		execution,
		promptHomeDir: options.promptHomeDir,
		restart: options.restart,
		sessions: options.sessions,
		state: options.state,
	});
	const cronBroadcaster = new RuntimeCronBroadcaster({
		agentId: options.agentId,
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
		noticeProvider: options.getFrontendNotice,
		messageRouter,
		promptDispatcher,
		state: options.state,
	});
	getStatusEvent = () => controller.getStatusEvent();
	return controller;
}
