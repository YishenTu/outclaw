import type {
	CronResultEvent,
	Facade,
	FacadeEvent,
	HeartbeatResult,
	HistoryReplayEvent,
	ImageRef,
	RuntimeStatusEvent,
} from "../../common/protocol.ts";
import { extractError, parseMessage } from "../../common/protocol.ts";
import { handleRuntimeCommand } from "../commands/handle-command.ts";
import { readHistory } from "../persistence/history-reader.ts";
import type { SessionStore } from "../persistence/session-store.ts";
import { assembleSystemPrompt } from "../prompt/assemble-system-prompt.ts";
import { ClientHub, type WsClient } from "../transport/client-hub.ts";
import { RuntimeImageEventExtractor } from "./image-event-extractor.ts";
import { MessageQueue } from "./message-queue.ts";
import { RuntimeState } from "./runtime-state.ts";

interface RuntimeControllerOptions {
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
	heartbeatInfoProvider?: () => {
		nextHeartbeatAt: number | undefined;
		deferred: boolean;
	};
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
	telegramChatId?: number;
	type?: string;
}

type PromptSource = "heartbeat" | "telegram" | "tui";

interface HeartbeatTask {
	prompt: string;
	scheduledAt: number;
	sessionId: string;
}

interface PromptExecution {
	images?: ImageRef[];
	prompt: string;
	sender?: WsClient;
	source: PromptSource;
	stream?: boolean;
	telegramChatId?: number;
}

interface CronExecutionResult {
	jobName: string;
	model: string;
	sessionId?: string;
	text: string;
}

export class RuntimeController {
	private activeAbort: AbortController | undefined;
	private activeDeferMinutes = 0;
	private deferTimer: ReturnType<typeof setTimeout> | undefined;
	private deliverCronResult:
		| RuntimeControllerOptions["deliverCronResult"]
		| undefined;
	private deliverHeartbeatResult:
		| RuntimeControllerOptions["deliverHeartbeatResult"]
		| undefined;
	private fireDeferredHeartbeat: (() => Promise<void> | void) | undefined;
	private heartbeatPending = false;
	private hub = new ClientHub();
	private lastUserActivityAt = Date.now();
	private heartbeatInfoProvider:
		| RuntimeControllerOptions["heartbeatInfoProvider"]
		| undefined;
	private queue = new MessageQueue();
	private shuttingDown = false;
	private readHistory: (
		sdkSessionId: string,
	) => Promise<HistoryReplayEvent["messages"]>;
	private state: RuntimeState;

	constructor(private options: RuntimeControllerOptions) {
		this.deliverCronResult = options.deliverCronResult;
		this.deliverHeartbeatResult = options.deliverHeartbeatResult;
		this.heartbeatInfoProvider = options.heartbeatInfoProvider;
		this.state = new RuntimeState(options.store);
		this.readHistory = options.historyReader ?? readHistory;
	}

	get currentModel(): string {
		return this.state.model;
	}

	setHeartbeatInfoProvider(
		provider: () => { nextHeartbeatAt: number | undefined; deferred: boolean },
	) {
		this.heartbeatInfoProvider = provider;
	}

	setFireDeferredHeartbeat(handler: () => Promise<void> | void) {
		this.fireDeferredHeartbeat = handler;
	}

	startDeferTimer(deferMinutes: number) {
		this.clearDeferTimer();
		this.activeDeferMinutes = deferMinutes;
		const elapsed = Date.now() - this.lastUserActivityAt;
		const delay = Math.max(deferMinutes * 60_000 - elapsed, 0);
		this.deferTimer = setTimeout(() => {
			this.deferTimer = undefined;
			void this.fireDeferredHeartbeat?.();
		}, delay);
	}

	private clearDeferTimer() {
		if (this.deferTimer !== undefined) {
			clearTimeout(this.deferTimer);
			this.deferTimer = undefined;
		}
	}

	private resetDeferTimer() {
		if (this.deferTimer === undefined) {
			return;
		}
		this.clearDeferTimer();
		this.deferTimer = setTimeout(() => {
			this.deferTimer = undefined;
			void this.fireDeferredHeartbeat?.();
		}, this.activeDeferMinutes * 60_000);
	}

	async broadcastCronResult(result: CronExecutionResult) {
		if (result.sessionId) {
			this.options.store?.upsert({
				sdkSessionId: result.sessionId,
				title: result.jobName,
				model: result.model,
				tag: "cron",
			});
		}

		const event: CronResultEvent = {
			type: "cron_result",
			jobName: result.jobName,
			text: result.text,
		};
		this.hub.broadcast(event);

		const telegramChatId = this.state.getLastTelegramChatId();
		if (!this.deliverCronResult || telegramChatId === undefined) {
			return;
		}

		try {
			await this.deliverCronResult({
				jobName: result.jobName,
				telegramChatId,
				text: result.text,
			});
		} catch (err) {
			console.error(
				`Failed to deliver cron result to Telegram: ${extractError(err)}`,
			);
		}
	}

	setCronResultHandler(handler: RuntimeControllerOptions["deliverCronResult"]) {
		this.deliverCronResult = handler;
	}

	setHeartbeatResultHandler(
		handler: RuntimeControllerOptions["deliverHeartbeatResult"],
	) {
		this.deliverHeartbeatResult = handler;
	}

	handleClose = (ws: WsClient) => {
		this.hub.remove(ws);
	};

	handleMessage = (ws: WsClient, message: string | Buffer) => {
		if (this.shuttingDown) {
			this.hub.send(ws, {
				type: "status",
				message: "Runtime shutting down",
			});
			return;
		}

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
				createStatusEvent: () => this.createStatusEvent(),
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
			this.enqueuePrompt({
				sender: ws,
				prompt,
				source: data.source === "telegram" ? "telegram" : "tui",
				images: data.images,
				telegramChatId: data.telegramChatId,
			});
		}
	};

	handleOpen = (ws: WsClient) => {
		this.hub.add(ws);
		this.hub.send(ws, this.createStatusEvent());
		void this.replayHistory([ws]);
	};

	beginShutdown() {
		this.shuttingDown = true;
		this.clearDeferTimer();
	}

	drain(): Promise<void> {
		return this.queue.drain();
	}

	broadcastRuntimeStatus() {
		this.hub.broadcast(this.createStatusEvent());
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

	enqueueHeartbeat(
		prompt: string,
		scheduledAt: number,
		deferMinutes: number,
	): boolean {
		if (this.shouldAttemptHeartbeat(scheduledAt, deferMinutes) !== "attempt") {
			return false;
		}

		const sessionId = this.state.sessionId;
		if (!sessionId) {
			return false;
		}

		this.heartbeatPending = true;
		this.queue.enqueue(() =>
			this.runHeartbeat({
				prompt,
				scheduledAt,
				sessionId,
			}),
		);
		return true;
	}

	shouldAttemptHeartbeat(
		scheduledAt: number,
		deferMinutes: number,
	): "attempt" | "skip" | "defer" {
		if (!this.state.sessionId || this.heartbeatPending) {
			return "skip";
		}

		if (deferMinutes === 0) {
			return "attempt";
		}

		if (scheduledAt - this.lastUserActivityAt >= deferMinutes * 60_000) {
			return "attempt";
		}

		return "defer";
	}

	private enqueuePrompt(task: PromptExecution) {
		this.state.preparePrompt(task.prompt, task.images);
		this.lastUserActivityAt = Date.now();
		this.resetDeferTimer();
		this.queue.enqueue(() => this.runPrompt(task));
	}

	private tuiTargets(exclude?: WsClient): WsClient[] {
		return this.hub.listByType("tui", exclude);
	}

	private async runHeartbeat(task: HeartbeatTask) {
		try {
			if (this.state.sessionId !== task.sessionId) {
				return;
			}
			if (this.lastUserActivityAt > task.scheduledAt) {
				return;
			}

			this.state.preparePrompt(task.prompt);
			await this.runPrompt({
				prompt: task.prompt,
				source: "heartbeat",
			});
		} finally {
			this.heartbeatPending = false;
		}
	}

	private async runPrompt(task: PromptExecution) {
		const abortController = new AbortController();
		this.activeAbort = abortController;
		const generation = this.state.generation;
		const observers =
			task.source === "telegram" || task.source === "heartbeat"
				? this.tuiTargets(task.sender)
				: [];
		const heartbeatDeliveryTarget =
			task.source === "heartbeat"
				? this.state.createHeartbeatDeliveryTarget()
				: undefined;
		const heartbeatBuffer: FacadeEvent[] = [];
		const imageEventExtractor = new RuntimeImageEventExtractor();

		try {
			try {
				if (task.source === "telegram" || task.source === "heartbeat") {
					this.hub.sendMany(observers, {
						type: "user_prompt",
						prompt: task.prompt,
						images: task.images,
						source: task.source,
					});
				}

				const emit = (event: FacadeEvent) => {
					if (task.source === "heartbeat") {
						heartbeatBuffer.push(event);
					}
					if (task.sender) {
						this.hub.send(task.sender, event);
					}
					this.hub.sendMany(observers, event);
					if (event.type === "done" && this.state.generation === generation) {
						this.state.completeRun(event, task.source, task.telegramChatId);
						this.broadcastRuntimeStatus();
					}
				};

				for await (const event of this.runFacade(task, abortController)) {
					emit(event);
					if (event.type !== "text") {
						continue;
					}

					for (const imageEvent of imageEventExtractor.extract(event.text)) {
						emit(imageEvent);
					}
				}
			} catch (err) {
				const errorEvent = {
					type: "error" as const,
					message: extractError(err),
				};
				if (task.source === "heartbeat") {
					heartbeatBuffer.push(errorEvent);
				}
				if (task.sender) {
					this.hub.send(task.sender, errorEvent);
				}
				this.hub.sendMany(observers, errorEvent);

				if (task.source !== "heartbeat") {
					return;
				}
			}

			if (
				task.source === "heartbeat" &&
				heartbeatDeliveryTarget?.clientType === "telegram" &&
				heartbeatDeliveryTarget.telegramChatId !== undefined &&
				this.deliverHeartbeatResult
			) {
				try {
					await this.deliverHeartbeatResult({
						telegramChatId: heartbeatDeliveryTarget.telegramChatId,
						...toHeartbeatResult(heartbeatBuffer),
					});
				} catch (err) {
					console.error(
						`Failed to deliver heartbeat result to Telegram: ${extractError(err)}`,
					);
				}
			}
		} finally {
			this.activeAbort = undefined;
		}
	}

	private async *runFacade(
		task: PromptExecution,
		abortController: AbortController,
	): AsyncIterable<FacadeEvent> {
		const systemPrompt = this.options.promptHomeDir
			? await assembleSystemPrompt(this.options.promptHomeDir)
			: undefined;

		yield* this.options.facade.run({
			prompt: task.prompt,
			images: task.images,
			systemPrompt,
			abortController,
			resume: this.state.sessionId,
			cwd: this.options.cwd,
			model: this.state.resolvedModel,
			effort: this.state.effort,
			stream: task.stream,
		});
	}
}

function toHeartbeatResult(events: FacadeEvent[]): HeartbeatResult {
	let text = "";
	const images: HeartbeatResult["images"] = [];

	for (const event of events) {
		if (event.type === "text") {
			text += event.text;
			continue;
		}

		if (event.type === "image") {
			images.push({
				path: event.path,
				caption: event.caption,
			});
			continue;
		}

		if (event.type === "error") {
			text = text
				? `${text}\n[error] ${event.message}`
				: `[error] ${event.message}`;
		}
	}

	return {
		images,
		text,
	};
}
