import type { DoneEvent, TranscriptTurn } from "../../common/protocol.ts";
import type { LastUserTarget } from "../persistence/last-user-target.ts";
import type {
	SessionRow,
	SessionStore,
	SessionTag,
} from "../persistence/session-store.ts";
import type { RuntimeState } from "./runtime-state.ts";

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

		if (event.usage) {
			this.store?.setUsage(this.state.providerId, event.sessionId, event.usage);
		}
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

	finishRolloverAttempt(params: { failed: boolean; idleMinutes: number }) {
		const lastInteractiveAt = this.store?.getLastInteractiveAt();
		if (lastInteractiveAt !== undefined) {
			this.store?.setLastHandledRolloverInteractiveAt(lastInteractiveAt);
		}

		const message = params.failed
			? `Previous session auto-finalized after ${formatIdleWindow(
					params.idleMinutes,
				)} idle. Final check failed. Use /session to resume.`
			: `Previous session auto-finalized after ${formatIdleWindow(
					params.idleMinutes,
				)} idle. Use /session to resume.`;

		this.clearActiveSession();
		this.store?.setRolloverNotice(message);
	}

	recordCronRun(params: { sessionId: string; jobName: string; model: string }) {
		this.store?.upsert({
			providerId: this.state.providerId,
			sdkSessionId: params.sessionId,
			title: params.jobName,
			model: params.model,
			tag: "cron",
		});
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
		this.store?.upsert({
			providerId: this.state.providerId,
			sdkSessionId: sessionId,
			title: this.state.sessionTitle ?? "Untitled",
			model: this.state.model,
			source: this.state.sessionSource,
			tag: "chat",
		});
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
			title: this.state.sessionTitle ?? "Untitled",
			model: this.state.model,
			source: this.state.sessionSource,
			tag: "chat",
			createdAt: 0,
			lastActive: 0,
		};
	}
}

function formatIdleWindow(idleMinutes: number): string {
	if (idleMinutes % 60 === 0) {
		return `${idleMinutes / 60}h`;
	}

	return `${idleMinutes}m`;
}
