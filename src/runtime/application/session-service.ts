import type { DoneEvent, TranscriptTurn } from "../../common/protocol.ts";
import type { LastUserTarget } from "../persistence/last-user-target.ts";
import type {
	SessionRow,
	SessionStore,
	SessionTag,
} from "../persistence/session-store/session-store.ts";
import type { RuntimeState } from "./state/runtime-state.ts";

export interface SessionListEntry {
	sdkSessionId: string;
	title: string;
	model: string;
	lastActive: number;
}

interface SessionServiceCallbacks {
	onAcceptedInteractivePrompt?: () => void;
	onSessionStateChange?: () => void;
}

export class SessionService {
	constructor(
		private readonly state: RuntimeState,
		private readonly store?: SessionStore,
		private readonly callbacks: SessionServiceCallbacks = {},
	) {
		this.restorePersistedState();
	}

	get activeSessionId(): string | undefined {
		return this.state.sessionId;
	}

	get providerId(): string {
		return this.state.providerId;
	}

	get lastUserTarget(): LastUserTarget | undefined {
		return this.state.getLastUserTarget();
	}

	listSessions(limit = 20, tag: SessionTag = "chat"): SessionListEntry[] {
		return (this.store?.list(limit, tag, this.state.providerId) ?? []).map(
			(session) => ({
				sdkSessionId: session.sdkSessionId,
				title: session.title,
				model: session.model,
				lastActive: session.lastActive,
			}),
		);
	}

	findSession(
		selector: string,
		tag: SessionTag = "chat",
	): SessionRow | undefined {
		return (
			this.store?.findByPrefix(this.state.providerId, selector, tag) ??
			this.matchCurrentSession(selector, tag)
		);
	}

	clearActiveSession() {
		this.state.clearSession();
		this.store?.setActiveSessionId(this.state.providerId, undefined);
		this.callbacks.onSessionStateChange?.();
	}

	deleteSession(sessionId: string): { clearedActiveSession: boolean } {
		const clearedActiveSession = this.state.sessionId === sessionId;
		this.store?.delete(this.state.providerId, sessionId);
		if (clearedActiveSession) {
			this.clearActiveSession();
		}
		return { clearedActiveSession };
	}

	completeRun(event: DoneEvent, source?: string, telegramChatId?: number) {
		this.state.completeRun(event, source, telegramChatId);
		this.persistActiveSession();
	}

	recordBackgroundCompletion(params: {
		event: DoneEvent;
		title: string;
		model: string;
		ocSessionId?: string;
		source: string;
	}) {
		this.persistSession({
			sessionId: params.event.sessionId,
			ocSessionId: params.ocSessionId,
			title: params.title,
			model: params.model,
			source: params.source,
			usage: params.event.usage,
		});
	}

	recordInterruptedRun(params: {
		sessionId: string;
		title: string;
		model: string;
		source: "agent" | "telegram" | "tui";
	}) {
		this.store?.setActiveSessionId(this.state.providerId, params.sessionId);
		this.persistSession(params);
		this.state.switchToSession(
			{
				agentId: "",
				providerId: this.state.providerId,
				sdkSessionId: params.sessionId,
				ocSessionId: params.sessionId,
				title: params.title,
				model: params.model,
				source: params.source,
				tag: "chat",
				createdAt: Date.now(),
				lastActive: Date.now(),
			},
			undefined,
		);
		this.callbacks.onSessionStateChange?.();
	}

	recordAcceptedPromptTarget(
		source: "telegram" | "tui",
		telegramChatId?: number,
	) {
		const target: LastUserTarget | undefined =
			source === "telegram"
				? telegramChatId !== undefined
					? {
							kind: "telegram",
							chatId: telegramChatId,
						}
					: undefined
				: {
						kind: "tui",
					};

		if (target) {
			this.state.setLastUserTarget(target);
			this.store?.setLastUserTarget(target);
		}
		this.store?.setLastInteractiveAt(Date.now());
		this.store?.setRolloverNotice(undefined);
		this.callbacks.onAcceptedInteractivePrompt?.();
	}

	getLastInteractiveAt(): number | undefined {
		return this.store?.getLastInteractiveAt();
	}

	getLastHandledRolloverInteractiveAt(): number | undefined {
		return this.store?.getLastHandledRolloverInteractiveAt();
	}

	getRolloverNotice(): string | undefined {
		return this.store?.getRolloverNotice();
	}

	renameSession(sessionId: string, title: string) {
		this.state.renameSession(sessionId, title);
		this.store?.rename(this.state.providerId, sessionId, title);
	}

	switchToSession(selector: string): SessionRow | undefined {
		const session = this.findSession(selector, "chat");
		if (!session) {
			return undefined;
		}

		this.state.switchToSession(
			session,
			this.store?.getUsage(this.state.providerId, session.sdkSessionId),
		);
		this.store?.setActiveSessionId(this.state.providerId, session.sdkSessionId);
		this.callbacks.onSessionStateChange?.();
		return session;
	}

	beginRolloverAttempt(idleMinutes: number) {
		const lastInteractiveAt = this.store?.getLastInteractiveAt();
		if (lastInteractiveAt !== undefined) {
			this.store?.setLastHandledRolloverInteractiveAt(lastInteractiveAt);
		}

		this.clearActiveSession();
		const notice = formatRolloverStartedNotice(idleMinutes);
		this.store?.setRolloverNotice(notice);
		return notice;
	}

	finishRolloverAttempt(params: { failed: boolean; idleMinutes: number }) {
		if (!params.failed) {
			return;
		}

		const expectedStartedMessage = formatRolloverStartedNotice(
			params.idleMinutes,
		);
		if (this.store?.getRolloverNotice() !== expectedStartedMessage) {
			return;
		}

		this.store?.setRolloverNotice(
			formatRolloverFailedNotice(params.idleMinutes),
		);
	}

	recordCronRun(params: {
		sessionId: string;
		jobName: string;
		model: string;
		ranAt: number;
		resultText?: string;
		failure?: {
			failedAt: number;
			message: string;
		};
	}) {
		this.store?.upsert({
			providerId: this.state.providerId,
			sdkSessionId: params.sessionId,
			title: params.jobName,
			model: params.model,
			tag: "cron",
			timestamp: params.ranAt,
			failure: params.failure,
		});
		if (params.resultText !== undefined && params.resultText !== "") {
			this.store?.replaceTranscript(this.state.providerId, params.sessionId, [
				{
					role: "assistant",
					content: params.resultText,
					timestamp: params.ranAt,
				},
			]);
		}
	}

	async refreshTranscript(
		sessionId: string,
		readTranscript?: (sessionId: string) => Promise<TranscriptTurn[]>,
	) {
		if (!this.store || !readTranscript) {
			return;
		}

		const turns = await readTranscript(sessionId);
		this.store.replaceTranscript(this.state.providerId, sessionId, turns);
	}

	private persistActiveSession() {
		const sessionId = this.state.sessionId;
		if (!sessionId) {
			return;
		}

		this.store?.setActiveSessionId(this.state.providerId, sessionId);
		this.persistSession({
			sessionId,
			ocSessionId: this.state.ocSessionId,
			title: this.state.sessionTitle ?? "Untitled",
			model: this.state.model,
			source: this.state.sessionSource,
			usage: this.state.usage,
		});
	}

	private persistSession(params: {
		sessionId: string;
		ocSessionId?: string;
		title: string;
		model: string;
		source: string;
		usage?: DoneEvent["usage"];
	}) {
		this.store?.upsert({
			providerId: this.state.providerId,
			sdkSessionId: params.sessionId,
			ocSessionId: params.ocSessionId,
			title: params.title,
			model: params.model,
			source: params.source,
			tag: "chat",
		});

		if (params.usage) {
			this.store?.setUsage(
				this.state.providerId,
				params.sessionId,
				params.usage,
			);
		}
	}

	private restorePersistedState() {
		if (!this.store) {
			return;
		}

		const activeSessionId = this.store.getActiveSessionId(
			this.state.providerId,
		);
		const session = activeSessionId
			? this.store.get(this.state.providerId, activeSessionId)
			: undefined;
		const usage =
			session && activeSessionId
				? this.store.getUsage(this.state.providerId, activeSessionId)
				: undefined;

		this.state.restorePersistedState({
			lastUserTarget: this.store.getLastUserTarget(),
			session,
			usage,
		});
	}

	private matchCurrentSession(
		selector: string,
		tag: SessionTag,
	): SessionRow | undefined {
		if (tag !== "chat") {
			return undefined;
		}
		const sessionId = this.state.sessionId;
		if (!sessionId?.startsWith(selector)) {
			return undefined;
		}

		return {
			agentId: "",
			providerId: this.state.providerId,
			sdkSessionId: sessionId,
			ocSessionId: this.state.ocSessionId,
			title: this.state.sessionTitle ?? "Untitled",
			model: this.state.model,
			source: this.state.sessionSource,
			tag: "chat",
			createdAt: 0,
			lastActive: 0,
		};
	}
}

export function formatRolloverStartedNotice(idleMinutes: number): string {
	return `Previous session auto-finalized after ${formatIdleWindow(
		idleMinutes,
	)} idle. A new session will begin with your next message. Use /session to resume.`;
}

function formatRolloverFailedNotice(idleMinutes: number): string {
	return `Previous session auto-finalized after ${formatIdleWindow(
		idleMinutes,
	)} idle. Final check failed. A new session will begin with your next message. Use /session to resume.`;
}

function formatIdleWindow(idleMinutes: number): string {
	if (idleMinutes % 60 === 0) {
		return `${idleMinutes / 60}h`;
	}

	return `${idleMinutes}m`;
}
