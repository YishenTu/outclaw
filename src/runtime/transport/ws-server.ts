import { ClaudeAdapter } from "../../backend/adapters/claude.ts";
import type { Facade, HistoryReplayEvent } from "../../common/protocol.ts";
import { RuntimeController } from "../application/runtime-controller.ts";
import { readHistory } from "../persistence/history-reader.ts";
import type { SessionStore } from "../persistence/session-store.ts";

interface RuntimeOptions {
	port: number;
	facade?: Facade;
	cwd?: string;
	promptHomeDir?: string;
	historyReader?: (
		sdkSessionId: string,
	) => Promise<HistoryReplayEvent["messages"]>;
	store?: SessionStore;
}

export function createRuntime(options: RuntimeOptions) {
	const controller = new RuntimeController({
		cwd: options.cwd,
		promptHomeDir: options.promptHomeDir,
		facade: options.facade ?? new ClaudeAdapter(),
		historyReader: options.historyReader ?? readHistory,
		store: options.store,
	});

	const server = Bun.serve<Record<string, never>>({
		port: options.port,
		fetch(req, server) {
			if (server.upgrade(req, { data: {} })) {
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

	return {
		port: server.port as number,
		stop() {
			server.stop();
		},
	};
}
