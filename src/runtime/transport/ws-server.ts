import type { Facade, HeartbeatResult } from "../../common/protocol.ts";
import { createAgentRuntime } from "../application/create-agent-runtime.ts";
import type { Config } from "../config.ts";
import type { SessionStore } from "../persistence/session-store.ts";
import { createSupervisor } from "../supervisor/create-supervisor.ts";

interface RuntimeOptions {
	port: number;
	facade: Facade;
	cwd?: string;
	restart?: () => void;
	cronDir?: string;
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
	promptHomeDir?: string;
	heartbeat?: Config["heartbeat"];
	store?: SessionStore;
}

export function createRuntime(options: RuntimeOptions) {
	const runtime = createAgentRuntime({
		agentId: "agent-default",
		cwd: options.cwd,
		cronDir: options.cronDir,
		deliverCronResult: options.deliverCronResult,
		deliverHeartbeatResult: options.deliverHeartbeatResult,
		facade: options.facade,
		heartbeat: options.heartbeat,
		name: "default",
		promptHomeDir: options.promptHomeDir,
		restart: options.restart,
		statusAgentName: undefined,
		store: options.store,
	});
	const supervisor = createSupervisor({
		agents: [runtime],
		emitAgentEvents: false,
		port: options.port,
	});

	return {
		port: supervisor.port,
		setCronResultHandler(handler: RuntimeOptions["deliverCronResult"]) {
			runtime.setCronResultHandler(handler);
		},
		setHeartbeatResultHandler(
			handler: RuntimeOptions["deliverHeartbeatResult"],
		) {
			runtime.setHeartbeatResultHandler(handler);
		},
		stop: supervisor.stop,
	};
}
