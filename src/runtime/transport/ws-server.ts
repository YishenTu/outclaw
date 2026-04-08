import { ClaudeAdapter } from "../../backend/adapters/claude.ts";
import type {
	Facade,
	HeartbeatResult,
	HistoryReplayEvent,
	RuntimeClientType,
} from "../../common/protocol.ts";
import { RuntimeController } from "../application/runtime-controller.ts";
import type { Config } from "../config.ts";
import { HeartbeatScheduler } from "../heartbeat/scheduler.ts";
import { readHistory } from "../persistence/history-reader.ts";
import type { SessionStore } from "../persistence/session-store.ts";

interface RuntimeOptions {
	port: number;
	facade?: Facade;
	cwd?: string;
	deliverHeartbeatResult?: (
		params: {
			telegramChatId: number;
		} & HeartbeatResult,
	) => Promise<void> | void;
	promptHomeDir?: string;
	heartbeat?: Config["heartbeat"];
	permissionMode?: "default" | "plan" | "bypassPermissions";
	historyReader?: (
		sdkSessionId: string,
	) => Promise<HistoryReplayEvent["messages"]>;
	store?: SessionStore;
}

export function createRuntime(options: RuntimeOptions) {
	const controller = new RuntimeController({
		cwd: options.cwd,
		promptHomeDir: options.promptHomeDir,
		facade: options.facade ?? new ClaudeAdapter(options.permissionMode),
		deliverHeartbeatResult: options.deliverHeartbeatResult,
		historyReader: options.historyReader ?? readHistory,
		store: options.store,
	});
	const heartbeat =
		options.promptHomeDir && options.heartbeat
			? new HeartbeatScheduler({
					config: options.heartbeat,
					promptHomeDir: options.promptHomeDir,
					shouldAttemptHeartbeat: (scheduledAt, deferMinutes) =>
						controller.shouldAttemptHeartbeat(scheduledAt, deferMinutes),
					requestHeartbeat: (prompt, scheduledAt, deferMinutes) =>
						controller.enqueueHeartbeat(prompt, scheduledAt, deferMinutes),
				})
			: undefined;

	const server = Bun.serve<{ clientType: RuntimeClientType }>({
		port: options.port,
		fetch(req, server) {
			const clientType = resolveClientType(req.url);
			if (server.upgrade(req, { data: { clientType } })) {
				return;
			}
			return new Response("misanthropic runtime", { status: 200 });
		},
		websocket: {
			close: controller.handleClose,
			message: controller.handleMessage,
			open: controller.handleOpen,
		},
	});
	heartbeat?.start();

	return {
		port: server.port as number,
		setHeartbeatResultHandler(
			handler: RuntimeOptions["deliverHeartbeatResult"],
		) {
			controller.setHeartbeatResultHandler(handler);
		},
		stop() {
			heartbeat?.stop();
			server.stop();
		},
	};
}

function resolveClientType(url: string): RuntimeClientType {
	const client = new URL(url).searchParams.get("client");
	return client === "telegram" ? "telegram" : "tui";
}
