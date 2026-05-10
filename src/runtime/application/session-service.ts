import type {
	DoneEvent,
	RolloverNotice,
	SessionCursor,
	SessionRenamedEvent,
	TranscriptTurn,
} from "../../common/protocol.ts";
import type { LastUserTarget } from "../persistence/last-user-target.ts";
import { nextSessionCursor } from "../persistence/session-cursor.ts";
import type {
	SessionRow,
	SessionStore,
	SessionTag,
} from "../persistence/session-store/session-store.ts";
import {
	type RuntimeState,
	resolveSessionTitleForPersistence,
} from "./state/runtime-state.ts";

export interface SessionListEntry {
	sdkSessionId: string;
	title: string;
	model: string;
	lastActive: number;
}

export interface SessionListResult {
	sessions: SessionListEntry[];
	nextCursor?: SessionCursor;
}

interface SessionServiceCallbacks {
	onAcceptedInteractivePrompt?: () => void;
	onActiveSessionChanged?: (event: {
		activeSessionId?: string;
		providerId: string;
	}) => void;
	onSessionCatalogChanged?: () => void;
	onSessionRenamed?: (event: SessionRenamedEvent) => void;
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

	get canPersistSessions(): boolean {
		return this.store !== undefined;
	}

	get lastUserTarget(): LastUserTarget | undefined {
		return this.state.getLastUserTarget();
	}

	listSessions(
		options: { cursor?: SessionCursor; limit?: number; tag?: SessionTag } = {},
	): SessionListResult {
		const limit = options.limit ?? 20;
		const sessions =
			this.store?.list({
				cursor: options.cursor,
				limit,
				providerId: this.state.providerId,
				tag: options.tag ?? "chat",
			}) ?? [];
		return {
			sessions: sessions.map(toSessionListEntry),
			nextCursor: nextSessionCursor(sessions, limit),
		};
	}

	searchSessions(options: {
		cursor?: SessionCursor;
		limit?: number;
		query: string;
		tag?: SessionTag;
	}): SessionListResult {
		const limit = options.limit ?? 20;
		const sessions =
			this.store?.searchByTitle({
				cursor: options.cursor,
				limit,
				providerId: this.state.providerId,
				query: options.query,
				tag: options.tag ?? "chat",
			}) ?? [];
		return {
			sessions: sessions.map(toSessionListEntry),
			nextCursor: nextSessionCursor(sessions, limit),
		};
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
		this.notifyActiveSessionChanged(undefined);
	}

	deleteSession(sessionId: string): { clearedActiveSession: boolean } {
		const clearedActiveSession = this.state.sessionId === sessionId;
		this.store?.delete(this.state.providerId, sessionId);
		if (clearedActiveSession) {
			this.state.clearSession();
			this.store?.setActiveSessionId(this.state.providerId, undefined);
			this.callbacks.onSessionStateChange?.();
		}
		this.notifySessionCatalogChanged();
		return { clearedActiveSession };
	}

	completeRun(event: DoneEvent, source?: string, telegramChatId?: number) {
		this.state.completeRun(event, source, telegramChatId);
		this.persistActiveSession();
		this.notifySessionCatalogChanged();
	}

	recordBackgroundCompletion(params: {
		event: DoneEvent;
		title: string;
		model: string;
		ocSessionId?: string;
		source: string;
	}) {
		const existing = this.store?.get(
			this.state.providerId,
			params.event.sessionId,
		);
		this.persistSession({
			sessionId: params.event.sessionId,
			ocSessionId: params.ocSessionId,
			title: existing?.title ?? params.title,
			model: params.model,
			source: params.source,
			usage: params.event.usage,
		});
		this.notifySessionCatalogChanged();
	}

	recordSessionInitialized(params: {
		active: boolean;
		sessionId: string;
		title: string;
		model: string;
		ocSessionId?: string;
		source: "agent" | "telegram" | "tui";
	}) {
		if (params.active) {
			this.state.initializeRun(params.sessionId, params.source);
			this.store?.setActiveSessionId(this.state.providerId, params.sessionId);
		}
		this.persistSession(params);
		if (params.active) {
			this.callbacks.onSessionStateChange?.();
		}
		this.notifySessionCatalogChanged();
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
				autoTitleAttempted: false,
			},
			undefined,
		);
		this.callbacks.onSessionStateChange?.();
		this.notifySessionCatalogChanged();
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

	getRolloverNotice(): RolloverNotice | undefined {
		return this.store?.getRolloverNotice();
	}

	renameSession(sessionId: string, title: string) {
		const isActiveSession = this.state.sessionId === sessionId;
		this.state.renameSession(sessionId, title);
		this.store?.rename(this.state.providerId, sessionId, title);
		this.notifySessionRenamed(sessionId, title, isActiveSession);
		this.notifySessionCatalogChanged();
	}

	configureCallbacks(callbacks: SessionServiceCallbacks) {
		this.callbacks.onAcceptedInteractivePrompt =
			callbacks.onAcceptedInteractivePrompt ??
			this.callbacks.onAcceptedInteractivePrompt;
		this.callbacks.onActiveSessionChanged =
			callbacks.onActiveSessionChanged ?? this.callbacks.onActiveSessionChanged;
		this.callbacks.onSessionCatalogChanged =
			callbacks.onSessionCatalogChanged ??
			this.callbacks.onSessionCatalogChanged;
		this.callbacks.onSessionRenamed =
			callbacks.onSessionRenamed ?? this.callbacks.onSessionRenamed;
		this.callbacks.onSessionStateChange =
			callbacks.onSessionStateChange ?? this.callbacks.onSessionStateChange;
	}

	applyAutoTitle(params: {
		sessionId: string;
		expectedTitle: string;
		title: string;
	}): boolean {
		if (!this.store) {
			return false;
		}

		const renamed = this.store.applyAutoTitle({
			providerId: this.state.providerId,
			sdkSessionId: params.sessionId,
			expectedTitle: params.expectedTitle,
			title: params.title,
		});
		if (!renamed) {
			return false;
		}

		const isActiveSession = this.state.sessionId === params.sessionId;
		if (isActiveSession) {
			this.state.renameSession(params.sessionId, params.title);
		}
		this.notifySessionRenamed(params.sessionId, params.title, isActiveSession);
		if (isActiveSession) {
			this.callbacks.onSessionStateChange?.();
		}
		this.notifySessionCatalogChanged();
		return true;
	}

	markAutoTitleAttempted(sessionId: string) {
		this.store?.markAutoTitleAttempted(this.state.providerId, sessionId);
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
		this.notifyActiveSessionChanged(session.sdkSessionId);
		return session;
	}

	beginRolloverAttempt(idleMinutes: number) {
		const lastInteractiveAt = this.store?.getLastInteractiveAt();
		if (lastInteractiveAt !== undefined) {
			this.store?.setLastHandledRolloverInteractiveAt(lastInteractiveAt);
		}

		this.clearActiveSession();
		const notice = createRolloverNotice(idleMinutes);
		this.store?.setRolloverNotice(notice);
		return notice;
	}

	finishRolloverAttempt(params: { failed: boolean; idleMinutes: number }) {
		if (!params.failed) {
			return;
		}

		const expectedStartedNotice = createRolloverNotice(params.idleMinutes);
		const currentNotice = this.store?.getRolloverNotice();
		if (
			currentNotice?.kind !== "rollover" ||
			currentNotice.message !== expectedStartedNotice.message ||
			currentNotice.finalCheck === "failed"
		) {
			return;
		}

		this.store?.setRolloverNotice({
			...expectedStartedNotice,
			message: formatRolloverFailedNotice(params.idleMinutes),
			finalCheck: "failed",
		});
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

		const existing = this.store?.get(this.state.providerId, sessionId);
		this.store?.setActiveSessionId(this.state.providerId, sessionId);
		this.persistSession({
			sessionId,
			ocSessionId: this.state.ocSessionId,
			title: resolveSessionTitleForPersistence({
				existingTitle: existing?.title,
				fallbackSessionTitle: this.state.sessionTitleFallback,
				sessionTitle: this.state.sessionTitle,
			}),
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
			autoTitleAttempted: false,
		};
	}

	private notifySessionRenamed(
		sessionId: string,
		title: string,
		active: boolean,
	) {
		this.callbacks.onSessionRenamed?.({
			type: "session_renamed",
			sdkSessionId: sessionId,
			title,
			providerId: this.state.providerId,
			active,
		});
	}

	private notifyActiveSessionChanged(activeSessionId: string | undefined) {
		if (!this.store) {
			return;
		}
		this.callbacks.onActiveSessionChanged?.({
			activeSessionId,
			providerId: this.state.providerId,
		});
	}

	private notifySessionCatalogChanged() {
		if (!this.store) {
			return;
		}
		this.callbacks.onSessionCatalogChanged?.();
	}
}

function toSessionListEntry(session: SessionRow): SessionListEntry {
	return {
		sdkSessionId: session.sdkSessionId,
		title: session.title,
		model: session.model,
		lastActive: session.lastActive,
	};
}

export function formatRolloverStartedNotice(idleMinutes: number): string {
	return `Previous session auto-finalized after ${formatIdleWindow(
		idleMinutes,
	)} idle. A new session will begin with your next message. Use /session to resume.`;
}

function createRolloverNotice(idleMinutes: number): RolloverNotice {
	return {
		kind: "rollover",
		message: formatRolloverStartedNotice(idleMinutes),
	};
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
