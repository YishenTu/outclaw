import type { EffortLevel } from "../../common/commands.ts";
import {
	type CodingSessionEvent,
	extractError,
	type FacadeEvent,
} from "../../common/protocol.ts";
import {
	formatMaybeProviderSessionRef,
	formatProviderSessionRef,
	providerSessionRefKey,
} from "../../common/provider-session-ref.ts";
import type { PromptExecution } from "../application/prompt-execution/prompt-dispatcher.ts";
import type { DetachedPromptStartResult } from "../application/prompt-execution/prompt-execution-runtime.ts";
import type { CodingSessionEventRecorder } from "./coding-session-event-hub.ts";
import type {
	CodingSessionRecord,
	CodingSessionRefResolution,
	CodingSessionRunStatus,
} from "./coding-session-store.ts";

export type { CodingSessionEventRecorder };

export interface CodePromptRequest {
	cwd: string;
	linkedChatSessionId?: string;
	prompt: string;
	model?: string;
	effort?: EffortLevel;
	serviceTier?: string;
}

export interface CodePromptResumeRequest {
	prompt: string;
	providerId?: string;
	sdkSessionId: string;
	model?: string;
	effort?: EffortLevel;
	serviceTier?: string;
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

export type CodePromptStopResult =
	| {
			status: "accepted";
			providerId: string;
			sdkSessionId: string;
	  }
	| {
			status: "rejected";
			message: string;
	  };

export type CodePromptCancelResult =
	| {
			status: "accepted";
			providerId: string;
			sdkSessionId: string;
	  }
	| {
			status: "already_terminal";
			providerId: string;
			sdkSessionId: string;
			state: "done" | "error" | "cancelled";
	  }
	| {
			status: "rejected";
			message: string;
	  };

export interface CodingSessionRecorder {
	resolveRef(params: {
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
	markCancelled?(params: { providerId: string; sdkSessionId: string }): void;
	markRunning?(params: { providerId: string; sdkSessionId: string }): void;
}

export interface CodingRepositoryRegistrar {
	registerForCwd(params: { cwd: string }): {
		id: string;
	};
}

interface CodingRuntimeOptions {
	codingEvents?: CodingSessionEventRecorder;
	codingRepositories?: CodingRepositoryRegistrar;
	codingSessions?: CodingSessionRecorder;
	getLinkedChatSessionId?: () => string | undefined;
	providerId: string;
	runDetachedPrompt(task: PromptExecution): DetachedPromptStartResult;
	steerActivePrompt?(params: {
		cwd: string;
		prompt: string;
		sdkSessionId: string;
	}): Promise<void>;
}

export class CodingRuntime {
	private activeTurns = new Map<string, { abort: () => boolean }>();
	private cancelledTurns = new Set<string>();

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
		let abortActiveTurn: (() => boolean) | undefined;

		const detachedResult = this.options.runDetachedPrompt({
			cwd: params.cwd,
			includeRuntimeSystemPrompt: false,
			...codingRunSettings(params),
			...(params.serviceTier
				? { serviceTierOverride: params.serviceTier }
				: {}),
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
					this.recordEvent(event.sessionId, event);
					this.recordEvent(event.sessionId, {
						type: "user_prompt",
						text: params.prompt,
					});
					if (abortActiveTurn) {
						this.trackActiveTurn(event.sessionId, abortActiveTurn);
					}
					settleStart({
						status: "accepted",
						providerId: this.options.providerId,
						sdkSessionId: event.sessionId,
					});
					return;
				}
				const eventSessionId = readEventSessionId(event);
				const inFlightSessionId =
					eventSessionId && initializedSessionIds.has(eventSessionId)
						? eventSessionId
						: !eventSessionId && settled
							? firstValue(initializedSessionIds)
							: undefined;
				if (inFlightSessionId) {
					this.recordEvent(inFlightSessionId, event);
				}
				if (event.type === "done" && inFlightSessionId) {
					if (this.consumeCancelledTurn(inFlightSessionId)) {
						this.forgetActiveTurn(inFlightSessionId);
						return;
					}
					this.markCompleted(
						params.cwd,
						inFlightSessionId,
						repositoryId,
						linkedChatSessionId,
					);
					this.forgetActiveTurn(inFlightSessionId);
					return;
				}
				if (event.type === "error" && inFlightSessionId) {
					if (this.consumeCancelledTurn(inFlightSessionId)) {
						this.forgetActiveTurn(inFlightSessionId);
						return;
					}
					this.markFailed(
						params.cwd,
						inFlightSessionId,
						repositoryId,
						linkedChatSessionId,
						event.message,
					);
					this.forgetActiveTurn(inFlightSessionId);
					return;
				}
				if (event.type === "turn_aborted" && inFlightSessionId) {
					this.markAborted(inFlightSessionId);
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
		} else {
			abortActiveTurn = detachedResult.abort;
			for (const sessionId of initializedSessionIds) {
				this.trackActiveTurn(sessionId, abortActiveTurn);
			}
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
				message: `Coding session is not open: ${formatProviderSessionRef(session)}`,
			};
		}
		if (
			session.runStatus === "running" ||
			this.activeTurns.has(providerSessionRefKey(session))
		) {
			return await this.steerRunningSession(session, params.prompt);
		}

		const detachedResult = this.options.runDetachedPrompt({
			cwd: session.cwd,
			includeRuntimeSystemPrompt: false,
			...codingRunSettings(params),
			...(params.serviceTier
				? { serviceTierOverride: params.serviceTier }
				: {}),
			onEvent: (event) => {
				if (event.type !== "session_initialized") {
					const eventSessionId = readEventSessionId(event);
					if (!eventSessionId || eventSessionId === params.sdkSessionId) {
						this.recordEvent(params.sdkSessionId, event);
					}
				}
				if (event.type === "done" && event.sessionId === params.sdkSessionId) {
					if (this.consumeCancelledTurn(params.sdkSessionId)) {
						this.forgetActiveTurn(params.sdkSessionId);
						return;
					}
					this.markCompleted(
						session.cwd,
						params.sdkSessionId,
						session.repositoryId,
						session.linkedChatSessionId,
					);
					this.forgetActiveTurn(params.sdkSessionId);
					return;
				}
				if (
					event.type === "error" &&
					(!event.sessionId || event.sessionId === params.sdkSessionId)
				) {
					if (this.consumeCancelledTurn(params.sdkSessionId)) {
						this.forgetActiveTurn(params.sdkSessionId);
						return;
					}
					this.markFailed(
						session.cwd,
						params.sdkSessionId,
						session.repositoryId,
						session.linkedChatSessionId,
						event.message,
					);
					this.forgetActiveTurn(params.sdkSessionId);
				}
				if (
					event.type === "turn_aborted" &&
					(!event.sessionId || event.sessionId === params.sdkSessionId)
				) {
					this.markAborted(params.sdkSessionId);
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

		this.trackActiveTurn(params.sdkSessionId, detachedResult.abort);
		this.recordEvent(params.sdkSessionId, {
			type: "user_prompt",
			text: params.prompt,
		});
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

	private async steerRunningSession(
		session: CodingSessionRecord,
		prompt: string,
	): Promise<CodePromptStartResult> {
		if (!this.options.steerActivePrompt) {
			return {
				status: "rejected",
				message: `Coding provider cannot steer running sessions: ${formatProviderSessionRef(session)}`,
			};
		}
		this.recordEvent(session.sdkSessionId, {
			type: "user_prompt",
			text: prompt,
		});
		try {
			await this.options.steerActivePrompt({
				cwd: session.cwd,
				prompt,
				sdkSessionId: session.sdkSessionId,
			});
		} catch (error) {
			return {
				status: "rejected",
				message: extractError(error),
			};
		}
		return {
			status: "accepted",
			providerId: session.providerId,
			sdkSessionId: session.sdkSessionId,
		};
	}

	stopPrompt(params: {
		providerId?: string;
		sdkSessionId: string;
	}): CodePromptStopResult {
		if (params.providerId && params.providerId !== this.options.providerId) {
			return {
				status: "rejected",
				message: `Coding provider mismatch: ${params.providerId}`,
			};
		}

		const target = this.resolveStopTarget(params);
		if (target.status === "rejected") {
			return target;
		}

		const key = providerSessionRefKey(target);
		const activeTurn = this.activeTurns.get(key);
		if (!activeTurn?.abort()) {
			this.activeTurns.delete(key);
			return {
				status: "rejected",
				message: `Coding session is not running: ${formatProviderSessionRef(target)}`,
			};
		}

		this.activeTurns.delete(key);
		return {
			status: "accepted",
			providerId: target.providerId,
			sdkSessionId: target.sdkSessionId,
		};
	}

	cancelPrompt(params: {
		providerId?: string;
		sdkSessionId: string;
	}): CodePromptCancelResult {
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

		const key = providerSessionRefKey(session);
		const activeTurn = this.activeTurns.get(key);
		if (!activeTurn) {
			const state = terminalStateForRunStatus(session.runStatus);
			if (state) {
				return {
					status: "already_terminal",
					providerId: session.providerId,
					sdkSessionId: session.sdkSessionId,
					state,
				};
			}
			return {
				status: "rejected",
				message: `Coding session is not running: ${formatProviderSessionRef(session)}`,
			};
		}
		if (!activeTurn.abort()) {
			this.activeTurns.delete(key);
			return {
				status: "rejected",
				message: `Coding session is not running: ${formatProviderSessionRef(session)}`,
			};
		}

		this.cancelledTurns.add(key);
		this.activeTurns.delete(key);
		this.markCancelled(session.sdkSessionId);
		return {
			status: "accepted",
			providerId: session.providerId,
			sdkSessionId: session.sdkSessionId,
		};
	}

	private resolveSessionRef(params: {
		providerId?: string;
		sdkSessionId: string;
	}):
		| { status: "resolved"; session: CodingSessionRecord }
		| { status: "rejected"; message: string } {
		const recorder = this.options.codingSessions;
		const resolution: CodingSessionRefResolution = recorder
			? recorder.resolveRef({
					providerId: params.providerId,
					sdkSessionId: params.sdkSessionId,
				})
			: { status: "not_found" };
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
			message: `Unknown coding session: ${formatMaybeProviderSessionRef(params)}`,
		};
	}

	private resolveStopTarget(params: {
		providerId?: string;
		sdkSessionId: string;
	}):
		| { status: "resolved"; providerId: string; sdkSessionId: string }
		| { status: "rejected"; message: string } {
		if (!this.options.codingSessions) {
			return {
				status: "resolved",
				providerId: this.options.providerId,
				sdkSessionId: params.sdkSessionId,
			};
		}

		const resolution = this.resolveSessionRef(params);
		if (resolution.status === "rejected") {
			return resolution;
		}
		if (resolution.session.providerId !== this.options.providerId) {
			return {
				status: "rejected",
				message: `Coding provider mismatch: ${resolution.session.providerId}`,
			};
		}
		return {
			status: "resolved",
			providerId: resolution.session.providerId,
			sdkSessionId: resolution.session.sdkSessionId,
		};
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

	private recordEvent(sdkSessionId: string, event: CodingSessionEvent) {
		this.options.codingEvents?.append({
			providerId: this.options.providerId,
			sdkSessionId,
			event,
		});
	}

	private trackActiveTurn(sessionId: string, abort: () => boolean) {
		this.activeTurns.set(
			providerSessionRefKey({
				providerId: this.options.providerId,
				sdkSessionId: sessionId,
			}),
			{
				abort,
			},
		);
	}

	private forgetActiveTurn(sessionId: string) {
		this.activeTurns.delete(
			providerSessionRefKey({
				providerId: this.options.providerId,
				sdkSessionId: sessionId,
			}),
		);
	}

	private consumeCancelledTurn(sessionId: string): boolean {
		const key = providerSessionRefKey({
			providerId: this.options.providerId,
			sdkSessionId: sessionId,
		});
		if (!this.cancelledTurns.has(key)) {
			return false;
		}
		this.cancelledTurns.delete(key);
		return true;
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

	private markCancelled(sessionId: string) {
		this.options.codingSessions?.markCancelled?.({
			providerId: this.options.providerId,
			sdkSessionId: sessionId,
		});
	}

	private markAborted(sessionId: string) {
		this.consumeCancelledTurn(sessionId);
		this.markCancelled(sessionId);
		this.forgetActiveTurn(sessionId);
	}
}

export function createCodingRuntime(
	options: CodingRuntimeOptions,
): CodingRuntime {
	return new CodingRuntime(options);
}

function codingRunSettings(params: {
	model?: string;
	effort?: EffortLevel;
}): Pick<
	PromptExecution,
	| "effortOverride"
	| "modelOverride"
	| "useProviderDefaultEffort"
	| "useProviderDefaultModel"
> {
	return {
		...(params.model
			? { modelOverride: params.model }
			: { useProviderDefaultModel: true }),
		...(params.effort
			? { effortOverride: params.effort }
			: { useProviderDefaultEffort: true }),
	};
}

function readEventSessionId(event: FacadeEvent): string | undefined {
	if ("sessionId" in event) {
		return event.sessionId;
	}
	return undefined;
}

function firstValue<T>(values: Iterable<T>): T | undefined {
	for (const value of values) {
		return value;
	}
	return undefined;
}

function terminalStateForRunStatus(
	runStatus: CodingSessionRunStatus,
): "done" | "error" | "cancelled" | undefined {
	if (runStatus === "idle") {
		return "done";
	}
	if (runStatus === "failed") {
		return "error";
	}
	if (runStatus === "cancelled") {
		return "cancelled";
	}
	return undefined;
}
