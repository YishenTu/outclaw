import type { Facade, HistoryReplayEvent } from "../../common/protocol.ts";
import { extractError, parseMessage } from "../../common/protocol.ts";
import { handleRuntimeCommand } from "../commands/handle-command.ts";
import { readHistory } from "../persistence/history-reader.ts";
import type { SessionStore } from "../persistence/session-store.ts";
import { ClientHub, type WsClient } from "../transport/client-hub.ts";
import { MessageQueue } from "./message-queue.ts";
import { RuntimeState } from "./runtime-state.ts";

interface RuntimeControllerOptions {
	cwd?: string;
	facade: Facade;
	historyReader?: (
		sdkSessionId: string,
	) => Promise<HistoryReplayEvent["messages"]>;
	store?: SessionStore;
}

interface IncomingMessage {
	command?: string;
	prompt?: string;
	source?: string;
	type?: string;
}

export class RuntimeController {
	private hub = new ClientHub();
	private queue = new MessageQueue();
	private readHistory: (
		sdkSessionId: string,
	) => Promise<HistoryReplayEvent["messages"]>;
	private state: RuntimeState;

	constructor(private options: RuntimeControllerOptions) {
		this.state = new RuntimeState(options.store);
		this.readHistory = options.historyReader ?? readHistory;
	}

	handleClose = (ws: WsClient) => {
		this.hub.remove(ws);
	};

	handleMessage = (ws: WsClient, message: string | Buffer) => {
		let data: IncomingMessage;
		try {
			data = parseMessage(message) as IncomingMessage;
		} catch (err) {
			this.hub.send(ws, {
				type: "error",
				message: extractError(err),
			});
			return;
		}

		if (data.type === "command" && data.command) {
			void handleRuntimeCommand({
				command: data.command,
				hub: this.hub,
				replayHistoryToAll: (sessionId) =>
					this.replayHistory(this.hub.list(), sessionId),
				state: this.state,
				store: this.options.store,
				ws,
			});
			return;
		}

		if (data.type === "prompt" && data.prompt) {
			this.state.preparePrompt(data.prompt);
			this.queue.enqueue(() =>
				this.runPrompt(ws, data.prompt as string, data.source),
			);
		}
	};

	handleOpen = (ws: WsClient) => {
		this.hub.add(ws);
		void this.replayHistory([ws]);
	};

	private async replayHistory(
		targets: Iterable<WsClient>,
		sessionId = this.state.sessionId,
	) {
		if (!sessionId) {
			return;
		}

		try {
			const messages = await this.readHistory(sessionId);
			this.hub.sendMany(targets, {
				type: "history_replay",
				messages,
			});
		} catch {
			// History is best-effort only.
		}
	}

	private async runPrompt(ws: WsClient, prompt: string, source?: string) {
		try {
			const isBroadcast = source === "telegram";

			if (isBroadcast) {
				this.hub.broadcast(
					{
						type: "user_prompt",
						prompt,
						source,
					},
					ws,
				);
			}

			for await (const event of this.options.facade.run({
				prompt,
				resume: this.state.sessionId,
				cwd: this.options.cwd,
				model: this.state.resolvedModel,
				effort: this.state.effort,
			})) {
				this.hub.send(ws, event);
				if (isBroadcast) {
					this.hub.broadcast(event, ws);
				}
				if (event.type === "done") {
					this.state.completeRun(event);
				}
			}
		} catch (err) {
			this.hub.send(ws, {
				type: "error",
				message: extractError(err),
			});
		}
	}
}
