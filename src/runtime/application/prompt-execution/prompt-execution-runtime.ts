import type { OutclawNativeToolHost } from "../../../common/native-tools.ts";
import type {
	HeartbeatResult,
	TranscriptTurn,
} from "../../../common/protocol.ts";
import type { WsClient } from "../../transport/client-hub.ts";
import type { AutoTitleCoordinator } from "../auto-title.ts";
import { RuntimeExecutionCoordinator } from "../runtime-execution-coordinator.ts";
import type { SessionService } from "../session-service.ts";
import type {
	RuntimePromptContext,
	RuntimeState,
} from "../state/runtime-state.ts";
import {
	type PromptClientGateway,
	PromptDispatcher,
	type PromptExecution,
} from "./prompt-dispatcher.ts";
import { type PromptProviderResolver, PromptRunner } from "./prompt-runner.ts";
import { StreamingStateStore } from "./streaming-state-store.ts";

export type DetachedPromptStartResult =
	| { status: "accepted"; ocSessionId: string; abort: () => boolean }
	| { status: "rejected"; message: string };

export interface PromptExecutionRuntimeOptions {
	autoTitle?: Pick<
		AutoTitleCoordinator,
		"cancel" | "cancelAll" | "drain" | "resolveSession" | "start"
	>;
	clients?: PromptClientGateway;
	createNativeToolHost?: (params: {
		context: RuntimePromptContext & { resumeSessionId?: string };
		readOnly: boolean;
		task: PromptExecution;
	}) => OutclawNativeToolHost | undefined;
	cwd?: string;
	deliverHeartbeatResult?: (
		params: {
			telegramChatId: number;
		} & HeartbeatResult,
	) => Promise<void> | void;
	deliverRolloverNotice?: (params: {
		telegramChatId: number;
		text: string;
	}) => Promise<void> | void;
	onStatusChange?: () => void;
	onVisibleRunStarted?: () => void;
	promptHomeDir?: string;
	providers: PromptProviderResolver;
	readTranscript?: (
		sessionId: string,
		context: RuntimePromptContext,
	) => Promise<TranscriptTurn[]> | undefined;
	sessions: SessionService;
	state: RuntimeState;
	streamingState?: StreamingStateStore;
}

export class PromptExecutionRuntime {
	readonly execution: RuntimeExecutionCoordinator;
	readonly promptDispatcher: PromptDispatcher;
	readonly streamingState: StreamingStateStore;

	constructor(options: PromptExecutionRuntimeOptions) {
		this.streamingState = options.streamingState ?? new StreamingStateStore();
		const promptRunner = new PromptRunner({
			cwd: options.cwd,
			providers: options.providers,
			promptHomeDir: options.promptHomeDir,
		});
		this.promptDispatcher = new PromptDispatcher({
			clients: options.clients ?? NULL_PROMPT_CLIENTS,
			createNativeToolHost: options.createNativeToolHost,
			deliverHeartbeatResult: options.deliverHeartbeatResult,
			onVisibleRunStarted: options.onVisibleRunStarted,
			promptRunner,
			readTranscript: options.readTranscript,
			sessions: options.sessions,
			state: options.state,
			streamingState: this.streamingState,
		});
		this.execution = new RuntimeExecutionCoordinator({
			autoTitle: options.autoTitle,
			deliverRolloverNotice: options.deliverRolloverNotice,
			onStatusChange: options.onStatusChange,
			promptDispatcher: this.promptDispatcher,
			sessions: options.sessions,
			state: options.state,
		});
	}

	get hasActiveRun(): boolean {
		return this.execution.hasActiveRun;
	}

	get hasVisibleRun(): boolean {
		return this.execution.hasVisibleRun;
	}

	beginShutdown() {
		this.execution.beginShutdown();
	}

	drain(): Promise<void> {
		return this.execution.drain();
	}

	runDetachedPrompt(task: PromptExecution): DetachedPromptStartResult {
		const result = this.execution.enqueueDetachedPrompt(task);
		if (!result) {
			return {
				status: "rejected",
				message: "Runtime shutting down",
			};
		}
		return {
			status: "accepted",
			ocSessionId: result.ocSessionId,
			abort: result.abort,
		};
	}
}

export function createPromptExecutionRuntime(
	options: PromptExecutionRuntimeOptions,
): PromptExecutionRuntime {
	return new PromptExecutionRuntime(options);
}

const NULL_PROMPT_CLIENTS: PromptClientGateway = {
	listBrowserTargets(_exclude?: WsClient) {
		return [];
	},
	listInteractiveTargets(_exclude?: WsClient) {
		return [];
	},
	send(_ws: WsClient) {},
	sendMany(_targets: Iterable<WsClient>) {},
};
