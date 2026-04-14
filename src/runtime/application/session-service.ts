import type { DoneEvent } from "../../common/protocol.ts";
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

export class SessionService {
	constructor(
		private readonly state: RuntimeState,
		private readonly store?: SessionStore,
	) {
		this.restorePersistedState();
	}

	get activeSessionId(): string | undefined {
		return this.state.sessionId;
	}

	get lastTelegramChatId(): number | undefined {
		return this.state.getLastTelegramChatId();
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
	}

	deleteSession(sessionId: string): { clearedActiveSession: boolean } {
		const clearedActiveSession = this.state.sessionId === sessionId;
		this.store?.delete(this.state.providerId, sessionId);
		if (clearedActiveSession) {
			this.clearActiveSession();
		}
		return { clearedActiveSession };
	}

	completeRun(
		event: DoneEvent,
		source?: string,
		telegramChatId?: number,
		telegramBotId?: string,
	) {
		this.state.completeRun(event, source, telegramChatId);
		this.persistActiveSession();

		if (source === "telegram" && telegramChatId !== undefined) {
			if (telegramBotId) {
				this.store?.setLastTelegramDelivery({
					botId: telegramBotId,
					chatId: telegramChatId,
				});
			}
		}
		if (event.usage) {
			this.store?.setUsage(this.state.providerId, event.sessionId, event.usage);
		}
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
		return session;
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
			lastTelegramChatId: this.store.getLastTelegramChatId(),
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
