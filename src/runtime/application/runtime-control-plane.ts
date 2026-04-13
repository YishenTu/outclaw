import { extractError } from "../../common/protocol.ts";
import { handleRuntimeCommand } from "../commands/handle-command.ts";
import type { WsClient } from "../transport/client-hub.ts";
import type { RuntimeClientGateway } from "./runtime-client-gateway.ts";
import type { RuntimeExecutionCoordinator } from "./runtime-execution-coordinator.ts";
import type { RuntimeState } from "./runtime-state.ts";
import type { SessionService } from "./session-service.ts";

interface RuntimeControlPlaneOptions {
	clients: RuntimeClientGateway;
	createStatusEvent: () => import("../../common/protocol.ts").RuntimeStatusEvent;
	execution: RuntimeExecutionCoordinator;
	restart?: () => void;
	sessions: SessionService;
	state: RuntimeState;
}

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
		if (cmd === "/new" || isSessionMutation(cmd)) {
			this.options.execution.abortActiveRun();
		}
		void handleRuntimeCommand({
			command,
			createStatusEvent: this.options.createStatusEvent,
			hub: this.options.clients.clientHub,
			replayHistoryToAll: (sessionId) =>
				this.options.clients.replayHistory(
					this.options.clients.listClients(),
					sessionId,
				),
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

	private handleStop(ws: WsClient) {
		if (this.options.execution.abortActiveRun()) {
			this.options.clients.send(ws, {
				type: "status",
				message: "Stopping current run",
			});
			return;
		}
		this.options.clients.send(ws, {
			type: "status",
			message: "Nothing to stop",
		});
	}
}

function isSessionMutation(cmd: string): boolean {
	if (!cmd.startsWith("/session ")) return false;
	const arg = cmd.slice("/session ".length).trim();
	return arg !== "" && arg !== "list";
}
