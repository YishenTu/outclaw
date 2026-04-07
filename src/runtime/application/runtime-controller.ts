import type {
	Facade,
	HistoryReplayEvent,
	ImageRef,
} from "../../common/protocol.ts";
import { extractError, parseMessage } from "../../common/protocol.ts";
import { handleRuntimeCommand } from "../commands/handle-command.ts";
import { readHistory } from "../persistence/history-reader.ts";
import type { SessionStore } from "../persistence/session-store.ts";
import { assembleSystemPrompt } from "../prompt/assemble-system-prompt.ts";
import { ClientHub, type WsClient } from "../transport/client-hub.ts";
import { MessageQueue } from "./message-queue.ts";
import { RuntimeState } from "./runtime-state.ts";

interface RuntimeControllerOptions {
	cwd?: string;
	promptHomeDir?: string;
	facade: Facade;
	historyReader?: (
		sdkSessionId: string,
	) => Promise<HistoryReplayEvent["messages"]>;
	store?: SessionStore;
}

interface IncomingMessage {
	command?: string;
	images?: ImageRef[];
	prompt?: string;
	source?: string;
	type?: string;
}

export class RuntimeController {
	private activeAbort: AbortController | undefined;
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
			const cmd = data.command.trim();
			if (cmd === "/stop") {
				this.handleStop(ws);
				return;
			}
			if (cmd === "/new" || this.isSessionMutation(cmd)) {
				this.activeAbort?.abort();
			}
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

		const prompt = data.prompt ?? "";
		const hasPrompt = prompt !== "";
		const hasImages = (data.images?.length ?? 0) > 0;

		if (data.type === "prompt" && (hasPrompt || hasImages)) {
			this.state.preparePrompt(prompt, data.images);
			this.queue.enqueue(() =>
				this.runPrompt(ws, prompt, data.source, data.images),
			);
		}
	};

	handleOpen = (ws: WsClient) => {
		this.hub.add(ws);
		void this.replayHistory([ws]);
	};

	private isSessionMutation(cmd: string): boolean {
		if (!cmd.startsWith("/session ")) return false;
		const arg = cmd.slice("/session ".length).trim();
		return arg !== "" && arg !== "list";
	}

	private handleStop(ws: WsClient) {
		if (this.activeAbort) {
			this.activeAbort.abort();
			this.hub.send(ws, { type: "status", message: "Stopping current run" });
			return;
		}
		this.hub.send(ws, { type: "status", message: "Nothing to stop" });
	}

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

	private async runPrompt(
		ws: WsClient,
		prompt: string,
		source?: string,
		images?: ImageRef[],
	) {
		const abortController = new AbortController();
		this.activeAbort = abortController;
		const generation = this.state.generation;

		try {
			const isBroadcast = source === "telegram";

			if (isBroadcast) {
				this.hub.broadcast(
					{
						type: "user_prompt",
						prompt,
						images,
						source,
					},
					ws,
				);
			}

			const systemPrompt = this.options.promptHomeDir
				? await assembleSystemPrompt(this.options.promptHomeDir)
				: undefined;

			for await (const event of this.options.facade.run({
				prompt,
				images,
				systemPrompt,
				abortController,
				resume: this.state.sessionId,
				cwd: this.options.cwd,
				model: this.state.resolvedModel,
				effort: this.state.effort,
			})) {
				this.hub.send(ws, event);
				if (isBroadcast) {
					this.hub.broadcast(event, ws);
				}
				if (event.type === "done" && this.state.generation === generation) {
					this.state.completeRun(event, source);
				}
			}
		} catch (err) {
			this.hub.send(ws, {
				type: "error",
				message: extractError(err),
			});
		} finally {
			this.activeAbort = undefined;
		}
	}
}
