import { type EffortLevel, isEffortLevel } from "../../common/commands.ts";
import {
	extractError,
	type ModelSelectMessage,
} from "../../common/protocol.ts";
import { handleRuntimeCommand } from "../commands/handle-command.ts";
import type { ModelProviderResolver } from "../model-provider-resolver.ts";
import type { SessionStore } from "../persistence/session-store/session-store.ts";
import type { WsClient } from "../transport/client-hub.ts";
import type { RuntimeClientGateway } from "./gateway/runtime-client-gateway.ts";
import type { RuntimeExecutionCoordinator } from "./runtime-execution-coordinator.ts";
import type { SessionService } from "./session-service.ts";
import type { RuntimeState } from "./state/runtime-state.ts";

interface RuntimeControlPlaneOptions {
	agentId?: string;
	clients: RuntimeClientGateway;
	createStatusEvent: () => import("../../common/protocol.ts").RuntimeStatusEvent;
	execution: RuntimeExecutionCoordinator;
	isProviderConfigured?: (providerId: string) => boolean;
	modelProviderResolver?: ModelProviderResolver;
	promptHomeDir?: string;
	restart?: () => void;
	sessions: SessionService;
	state: RuntimeState;
	store?: SessionStore;
}

type RuntimeModelSelection = ModelSelectMessage & {
	contextWindow?: number;
};

export class RuntimeControlPlane {
	constructor(private readonly options: RuntimeControlPlaneOptions) {}

	handleCommand(ws: WsClient, command: string) {
		const cmd = command.trim();
		if (cmd === "/stop") {
			this.handleStop(ws);
			return;
		}
		if (cmd === "/restart") {
			this.handleRestart(ws);
			return;
		}
		if (cmd === "/new" || shouldAbortActiveRun(cmd)) {
			this.options.execution.abortActiveRun();
		}
		void handleRuntimeCommand({
			command,
			createStatusEvent: this.options.createStatusEvent,
			hub: this.options.clients.clientHub,
			modelProviderResolver: this.options.modelProviderResolver,
			promptHomeDir: this.options.promptHomeDir,
			replayHistoryToAll: (session) =>
				this.options.clients.replayHistory(
					this.options.clients.listClients(),
					session,
				),
			selectProviderModel: (selection) =>
				this.handleModelSelect(ws, {
					type: "model_select",
					...selection,
				}),
			sessions: this.options.sessions,
			state: this.options.state,
			ws,
		});
	}

	private handleRestart(ws: WsClient) {
		if (!this.options.restart) {
			this.options.clients.send(ws, {
				type: "error",
				message: "Restart handler not configured",
			});
			return;
		}
		this.options.execution.abortActiveRun();
		this.options.clients.broadcast({
			type: "status",
			message: "Restarting daemon...",
		});
		try {
			this.options.restart();
		} catch (err) {
			this.options.clients.broadcast({
				type: "error",
				message: `Restart failed: ${extractError(err)}`,
			});
		}
	}

	handleModelSelect(ws: WsClient, message: RuntimeModelSelection) {
		const currentProviderId = this.options.state.providerId;
		const visibleSessionId = this.options.state.sessionId;
		// Cross-provider switches with an active session must come through an
		// explicit new-session boundary. The browser model picker hides
		// other-provider models while a session is live, but harden the
		// runtime path too — text/Telegram callers should not be able to
		// silently change providers mid-conversation.
		if (
			message.providerId !== currentProviderId &&
			visibleSessionId !== undefined
		) {
			this.options.clients.send(ws, {
				type: "error",
				message: `Cannot switch to ${message.providerId} while a ${currentProviderId} session is active; start a new session first.`,
			});
			return;
		}

		const targetProvider = message.providerId;
		const targetModel = message.model;
		const effortArg = message.effort;

		if (
			this.options.isProviderConfigured &&
			!this.options.isProviderConfigured(targetProvider)
		) {
			this.options.clients.send(ws, {
				type: "error",
				message: `Provider ${targetProvider} is not configured in this runtime.`,
			});
			return;
		}

		if (effortArg !== undefined && !isEffortLevel(effortArg)) {
			this.options.clients.send(ws, {
				type: "error",
				message: `Invalid effort: ${effortArg}`,
			});
			return;
		}

		// Provider change with no visible session: update the active provider
		// AND persist the blank-session selection so the choice survives a
		// daemon restart.
		if (targetProvider !== currentProviderId) {
			this.options.state.setProvider(targetProvider);
		}

		this.options.state.setProviderModel(targetModel, {
			contextWindow: message.contextWindow,
		});

		if (effortArg !== undefined) {
			this.options.state.setEffort(effortArg as EffortLevel);
		}
		this.options.state.setServiceTier(message.serviceTier);

		if (
			visibleSessionId === undefined &&
			this.options.store &&
			this.options.agentId
		) {
			this.options.store.setBlankChatModelSelection({
				providerId: targetProvider,
				model: targetModel,
				effort: this.options.state.effort,
				...(message.serviceTier ? { serviceTier: message.serviceTier } : {}),
			});
		}

		this.options.clients.broadcast({
			type: "model_changed",
			model: targetModel,
			providerId: targetProvider,
		});
		this.options.clients.broadcast({
			type: "effort_changed",
			effort: this.options.state.effort,
			providerId: targetProvider,
		});
		this.options.clients.broadcast(this.options.createStatusEvent());
	}

	private handleStop(ws: WsClient) {
		if (this.options.execution.abortActiveRun()) {
			this.options.clients.send(ws, {
				type: "status",
				message: "Request interrupted by user",
				presentation: "inline",
			});
			return;
		}
		this.options.clients.send(ws, {
			type: "status",
			message: "Nothing to stop",
			presentation: "inline",
		});
	}
}

function shouldAbortActiveRun(cmd: string): boolean {
	if (!cmd.startsWith("/session ")) return false;
	const arg = cmd.slice("/session ".length).trim();
	return arg === "delete" || arg.startsWith("delete ");
}
