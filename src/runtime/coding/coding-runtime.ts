import type { PromptExecution } from "../application/prompt-execution/prompt-dispatcher.ts";
import type { DetachedPromptStartResult } from "../application/runtime-controller.ts";
import type {
	CodingSessionRecord,
	CodingSessionRefResolution,
	CodingSessionRunStatus,
} from "./coding-session-store.ts";

export interface CodePromptRequest {
	cwd: string;
	linkedChatSessionId?: string;
	prompt: string;
}

export interface CodePromptResumeRequest {
	prompt: string;
	providerId?: string;
	sdkSessionId: string;
}

export type CodePromptStartResult =
	| {
			status: "accepted";
			providerId: string;
			sdkSessionId: string;
	  }
	| {
			status: "rejected";
			message: string;
	  };

export interface CodingSessionRecorder {
	get?(
		providerId: string,
		sdkSessionId: string,
	): CodingSessionRecord | undefined;
	resolveRef?(params: {
		providerId?: string;
		sdkSessionId: string;
	}): CodingSessionRefResolution;
	upsert(params: {
		providerId: string;
		sdkSessionId: string;
		repositoryId?: string;
		cwd: string;
		linkedChatSessionId?: string;
		runStatus: CodingSessionRunStatus;
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
	registerForCwd(params: { cwd: string }): {
		id: string;
	};
}

interface CodingRuntimeOptions {
	codingRepositories?: CodingRepositoryRegistrar;
	codingSessions?: CodingSessionRecorder;
	getLinkedChatSessionId?: () => string | undefined;
	providerId: string;
	runDetachedPrompt(task: PromptExecution): DetachedPromptStartResult;
}

export class CodingRuntime {
	constructor(private readonly options: CodingRuntimeOptions) {}

	startPrompt(params: CodePromptRequest): Promise<CodePromptStartResult> {
		const initializedSessionIds = new Set<string>();
		const linkedChatSessionId =
			params.linkedChatSessionId ?? this.options.getLinkedChatSessionId?.();
		const repositoryId = this.registerRepository(params.cwd)?.id;
		let settleStart: (result: CodePromptStartResult) => void = () => {};
		let settled = false;
		const start = new Promise<CodePromptStartResult>((resolve) => {
			settleStart = (result) => {
				if (settled) {
					return;
				}
				settled = true;
				resolve(result);
			};
		});

		const detachedResult = this.options.runDetachedPrompt({
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
						linkedChatSessionId,
					);
					settleStart({
						status: "accepted",
						providerId: this.options.providerId,
						sdkSessionId: event.sessionId,
					});
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
						linkedChatSessionId,
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
						linkedChatSessionId,
						event.message,
					);
					return;
				}
				if (event.type === "error" && !settled) {
					settleStart({
						status: "rejected",
						message: event.message,
					});
					return;
				}
				if (event.type === "done" && !settled) {
					settleStart({
						status: "rejected",
						message: "Coding session did not initialize",
					});
				}
			},
			prompt: params.prompt,
			sessionTag: "code",
			source: "agent",
			storedSessionSource: "code",
		});
		if (detachedResult.status === "rejected") {
			settleStart(detachedResult);
		}
		return start;
	}

	async resumePrompt(
		params: CodePromptResumeRequest,
	): Promise<CodePromptStartResult> {
		if (params.providerId && params.providerId !== this.options.providerId) {
			return {
				status: "rejected",
				message: `Coding provider mismatch: ${params.providerId}`,
			};
		}

		const resolution = this.resolveSessionRef(params);
		if (resolution.status === "rejected") {
			return resolution;
		}
		const session = resolution.session;
		if (session.providerId !== this.options.providerId) {
			return {
				status: "rejected",
				message: `Coding provider mismatch: ${session.providerId}`,
			};
		}
		if (session.lifecycleStatus !== "open") {
			return {
				status: "rejected",
				message: `Coding session is not open: ${params.providerId}/${params.sdkSessionId}`,
			};
		}
		if (session.runStatus === "running") {
			return {
				status: "rejected",
				message: `Coding session is busy: ${params.providerId}/${params.sdkSessionId}`,
			};
		}

		const detachedResult = this.options.runDetachedPrompt({
			cwd: session.cwd,
			includeRuntimeSystemPrompt: false,
			onEvent: (event) => {
				if (event.type === "done" && event.sessionId === params.sdkSessionId) {
					this.markCompleted(
						session.cwd,
						params.sdkSessionId,
						session.repositoryId,
						session.linkedChatSessionId,
					);
					return;
				}
				if (
					event.type === "error" &&
					(!event.sessionId || event.sessionId === params.sdkSessionId)
				) {
					this.markFailed(
						session.cwd,
						params.sdkSessionId,
						session.repositoryId,
						session.linkedChatSessionId,
						event.message,
					);
				}
			},
			prompt: params.prompt,
			resumeSessionId: params.sdkSessionId,
			sessionTag: "code",
			source: "agent",
			storedSessionSource: "code",
		});
		if (detachedResult.status === "rejected") {
			return detachedResult;
		}

		this.options.codingSessions?.markRunning?.({
			providerId: session.providerId,
			sdkSessionId: params.sdkSessionId,
		});
		return {
			status: "accepted",
			providerId: session.providerId,
			sdkSessionId: params.sdkSessionId,
		};
	}

	private resolveSessionRef(params: {
		providerId?: string;
		sdkSessionId: string;
	}):
		| { status: "resolved"; session: CodingSessionRecord }
		| { status: "rejected"; message: string } {
		const resolution = this.options.codingSessions?.resolveRef
			? this.options.codingSessions.resolveRef({
					providerId: params.providerId,
					sdkSessionId: params.sdkSessionId,
				})
			: this.resolveSessionRefFallback(params);
		if (resolution.status === "resolved") {
			return resolution;
		}
		if (resolution.status === "ambiguous") {
			return {
				status: "rejected",
				message: `Ambiguous coding session: ${params.sdkSessionId}`,
			};
		}
		return {
			status: "rejected",
			message: params.providerId
				? `Unknown coding session: ${params.providerId}/${params.sdkSessionId}`
				: `Unknown coding session: ${params.sdkSessionId}`,
		};
	}

	private resolveSessionRefFallback(params: {
		providerId?: string;
		sdkSessionId: string;
	}): CodingSessionRefResolution {
		if (!params.providerId) {
			return { status: "not_found" };
		}
		const session = this.options.codingSessions?.get?.(
			params.providerId,
			params.sdkSessionId,
		);
		return session ? { status: "resolved", session } : { status: "not_found" };
	}

	private registerRepository(cwd: string): { id: string } | undefined {
		if (!this.options.codingRepositories) {
			return undefined;
		}
		return this.options.codingRepositories.registerForCwd({
			cwd,
		});
	}

	private recordSession(
		cwd: string,
		sessionId: string,
		repositoryId: string | undefined,
		runStatus: CodingSessionRunStatus,
		linkedChatSessionId: string | undefined,
	) {
		this.options.codingSessions?.upsert({
			providerId: this.options.providerId,
			sdkSessionId: sessionId,
			repositoryId,
			cwd,
			linkedChatSessionId,
			runStatus,
		});
	}

	private markCompleted(
		cwd: string,
		sessionId: string,
		repositoryId: string | undefined,
		linkedChatSessionId: string | undefined,
	) {
		if (this.options.codingSessions?.markCompleted) {
			this.options.codingSessions.markCompleted({
				providerId: this.options.providerId,
				sdkSessionId: sessionId,
			});
			return;
		}
		this.recordSession(
			cwd,
			sessionId,
			repositoryId,
			"idle",
			linkedChatSessionId,
		);
	}

	private markFailed(
		cwd: string,
		sessionId: string,
		repositoryId: string | undefined,
		linkedChatSessionId: string | undefined,
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
		this.recordSession(
			cwd,
			sessionId,
			repositoryId,
			"failed",
			linkedChatSessionId,
		);
	}
}

export function createCodingRuntime(
	options: CodingRuntimeOptions,
): CodingRuntime {
	return new CodingRuntime(options);
}
