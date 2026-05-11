import type { PromptExecution } from "../application/prompt-execution/prompt-dispatcher.ts";
import type { DetachedPromptStartResult } from "../application/runtime-controller.ts";
import type {
	CodingSessionStatus,
	LinkedChatSession,
} from "./coding-session-store.ts";

export interface CodePromptRequest {
	cwd: string;
	linkedChat?: LinkedChatSession;
	prompt: string;
}

export type CodePromptStartResult = DetachedPromptStartResult;

export interface CodingSessionRecorder {
	upsert(params: {
		providerId: string;
		sdkSessionId: string;
		repositoryId?: string;
		cwd: string;
		linkedChat?: LinkedChatSession;
		status: CodingSessionStatus;
	}): void;
	markCompleted?(params: { providerId: string; sdkSessionId: string }): void;
	markFailed?(params: {
		providerId: string;
		sdkSessionId: string;
		message?: string;
	}): void;
	markRunning?(params: { providerId: string; sdkSessionId: string }): void;
}

export interface CodingRepositoryRegistrar {
	registerForCwd(params: { cwd: string; defaultAgentId: string }): {
		id: string;
	};
}

interface CodingRuntimeOptions {
	codingRepositories?: CodingRepositoryRegistrar;
	codingSessions?: CodingSessionRecorder;
	defaultAgentId?: string;
	getLinkedChatSession?: () => LinkedChatSession | undefined;
	providerId: string;
	runDetachedPrompt(task: PromptExecution): DetachedPromptStartResult;
}

export class CodingRuntime {
	constructor(private readonly options: CodingRuntimeOptions) {}

	runPrompt(params: CodePromptRequest): CodePromptStartResult {
		const initializedSessionIds = new Set<string>();
		const linkedChat =
			params.linkedChat ?? this.options.getLinkedChatSession?.();
		const repositoryId = this.registerRepository(params.cwd)?.id;
		return this.options.runDetachedPrompt({
			cwd: params.cwd,
			includeRuntimeSystemPrompt: false,
			onEvent: (event) => {
				if (event.type === "session_initialized") {
					initializedSessionIds.add(event.sessionId);
					this.recordSession(
						params.cwd,
						event.sessionId,
						repositoryId,
						"running",
						linkedChat,
					);
					return;
				}
				if (
					event.type === "done" &&
					initializedSessionIds.has(event.sessionId)
				) {
					this.markCompleted(
						params.cwd,
						event.sessionId,
						repositoryId,
						linkedChat,
					);
					return;
				}
				if (
					event.type === "error" &&
					event.sessionId &&
					initializedSessionIds.has(event.sessionId)
				) {
					this.markFailed(
						params.cwd,
						event.sessionId,
						repositoryId,
						linkedChat,
						event.message,
					);
				}
			},
			prompt: params.prompt,
			sessionTag: "code",
			source: "agent",
			storedSessionSource: "code",
		});
	}

	private registerRepository(cwd: string): { id: string } | undefined {
		if (!this.options.codingRepositories || !this.options.defaultAgentId) {
			return undefined;
		}
		return this.options.codingRepositories.registerForCwd({
			cwd,
			defaultAgentId: this.options.defaultAgentId,
		});
	}

	private recordSession(
		cwd: string,
		sessionId: string,
		repositoryId: string | undefined,
		status: CodingSessionStatus,
		linkedChat: LinkedChatSession | undefined,
	) {
		this.options.codingSessions?.upsert({
			providerId: this.options.providerId,
			sdkSessionId: sessionId,
			repositoryId,
			cwd,
			linkedChat,
			status,
		});
	}

	private markCompleted(
		cwd: string,
		sessionId: string,
		repositoryId: string | undefined,
		linkedChat: LinkedChatSession | undefined,
	) {
		if (this.options.codingSessions?.markCompleted) {
			this.options.codingSessions.markCompleted({
				providerId: this.options.providerId,
				sdkSessionId: sessionId,
			});
			return;
		}
		this.recordSession(cwd, sessionId, repositoryId, "completed", linkedChat);
	}

	private markFailed(
		cwd: string,
		sessionId: string,
		repositoryId: string | undefined,
		linkedChat: LinkedChatSession | undefined,
		message: string,
	) {
		if (this.options.codingSessions?.markFailed) {
			this.options.codingSessions.markFailed({
				providerId: this.options.providerId,
				sdkSessionId: sessionId,
				message,
			});
			return;
		}
		this.recordSession(cwd, sessionId, repositoryId, "failed", linkedChat);
	}
}

export function createCodingRuntime(
	options: CodingRuntimeOptions,
): CodingRuntime {
	return new CodingRuntime(options);
}
