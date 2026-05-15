import type {
	Facade,
	FrontendNotice,
	HeartbeatResult,
	SkillInfo,
	WorkspaceFileEntry,
} from "../../common/protocol.ts";
import type { SessionStore } from "../persistence/session-store/session-store.ts";
import type { WsClient } from "../transport/client-hub.ts";
import { AutoTitleCoordinator } from "./auto-title.ts";
import { RuntimeClientGateway } from "./gateway/runtime-client-gateway.ts";
import { RuntimeMessageRouter } from "./gateway/runtime-message-router.ts";
import { PromptDispatcher } from "./prompt-execution/prompt-dispatcher.ts";
import {
	type PromptProviderResolver,
	PromptRunner,
	singleFacadeResolver,
} from "./prompt-execution/prompt-runner.ts";
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
	/**
	 * Optional provider resolver. When supplied, prompt execution routes by
	 * `providerId` from each prompt context. When omitted, the runtime falls
	 * back to a single-facade resolver bound to `facade`.
	 */
	providers?: PromptProviderResolver;
	getFrontendNotice?: () => FrontendNotice | undefined;
	listSkills?: () => Promise<SkillInfo[]>;
	listWorkspaceFiles?: () => Promise<WorkspaceFileEntry[]>;
	onExecutionStateChange?: () => void;
	promptHomeDir?: string;
	restart?: () => void;
	sessions: SessionService;
	state: RuntimeState;
	store?: SessionStore;
}

export function createRuntimeController(
	options: CreateRuntimeControllerOptions,
) {
	// Safe during construction: collaborators only invoke this after the
	// controller has been fully assembled, when heartbeat-enriched status is ready.
	let getStatusEvent = () => options.state.createStatusEvent();
	const streamingState = new StreamingStateStore();
	const providersForRunner =
		options.providers ?? singleFacadeResolver(options.facade);
	const store = options.store;
	const clients = new RuntimeClientGateway({
		canSendToClient: options.canSendToClient,
		cwd: options.cwd,
		facade: options.facade,
		resolveFacadeForProvider: (providerId) => {
			try {
				return providersForRunner.getFacade(providerId);
			} catch {
				return undefined;
			}
		},
		// Replay is provider-aware: look up the session's provider in the
		// store and resolve the facade through the configured provider set
		// so a Codex chat session's history is read by the Codex adapter
		// even when the runtime's primary facade is Claude.
		resolveFacadeForSession: (providerId, sessionId) => {
			const row =
				providerId !== undefined
					? store?.get(providerId, sessionId)
					: store?.findBySdkSessionId(sessionId);
			const resolvedProviderId = providerId ?? row?.providerId;
			if (!resolvedProviderId) {
				return undefined;
			}
			try {
				return providersForRunner.getFacade(resolvedProviderId);
			} catch {
				return undefined;
			}
		},
		listSkills: options.listSkills,
		listWorkspaceFiles: options.listWorkspaceFiles,
		getStreamingSyncEvent: (providerId, sessionId) => {
			const snapshot = streamingState.get(
				providerId ?? options.state.providerId,
				sessionId,
			);
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
		providers: providersForRunner,
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
				providers: providersForRunner,
				model: options.autoTitle.model,
				sessions: options.sessions,
			})
		: undefined;
	const promptDispatcher = new PromptDispatcher({
		clients,
		deliverHeartbeatResult: options.deliverHeartbeatResult,
		onVisibleRunStarted: () => clients.broadcastStatus(),
		promptRunner,
		// Transcript refresh follows the run's provider, not the runtime's
		// primary facade — a completed Codex chat run reads its transcript
		// through the Codex adapter, never through Claude.
		readTranscript: (sessionId, context) => {
			const facade = providersForRunner.getFacade(context.providerId);
			return facade.readTranscript?.(sessionId);
		},
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
		agentId: options.agentId,
		clients,
		createStatusEvent: () => getStatusEvent(),
		execution,
		isProviderConfigured: (providerId) => {
			try {
				providersForRunner.getFacade(providerId);
				return true;
			} catch {
				return false;
			}
		},
		promptHomeDir: options.promptHomeDir,
		restart: options.restart,
		sessions: options.sessions,
		state: options.state,
		store: options.store,
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
