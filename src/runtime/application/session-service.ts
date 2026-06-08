import { isEffortLevel } from "../../common/commands.ts";
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
	providerId: string;
	sdkSessionId: string;
	title: string;
	model: string;
	lastActive: number;
}

export interface SessionListResult {
	sessions: SessionListEntry[];
	nextCursor?: SessionCursor;
}

export type SessionResolveResult =
	| { status: "found"; session: SessionRow }
	| { status: "ambiguous" }
	| { status: "not_found" };

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

interface BlankChatModelSelection {
	providerId: string;
	model: string;
	effort: string;
	serviceTier?: string;
}

interface SessionServicePolicy {
	defaultBlankSelection?: BlankChatModelSelection;
	writableProviderIds?: ReadonlySet<string>;
}

export class SessionService {
	constructor(
		private readonly state: RuntimeState,
		private readonly store?: SessionStore,
		private readonly callbacks: SessionServiceCallbacks = {},
		private readonly policy: SessionServicePolicy = {},
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
		options: {
			cursor?: SessionCursor;
			limit?: number;
			providerId?: string;
			tag?: SessionTag;
		} = {},
	): SessionListResult {
		const limit = options.limit ?? 20;
		const sessions =
			this.store?.list({
				cursor: options.cursor,
				limit,
				providerId: options.providerId,
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
		providerId?: string;
		query: string;
		tag?: SessionTag;
	}): SessionListResult {
		const limit = options.limit ?? 20;
		const sessions =
			this.store?.searchByTitle({
				cursor: options.cursor,
				limit,
				providerId: options.providerId,
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
		const result = this.resolveSession(selector, tag);
		return result.status === "found" ? result.session : undefined;
	}

	resolveSession(
		selector: string,
		tag: SessionTag = "chat",
	): SessionResolveResult {
		const providerRef = parseProviderSessionRef(selector);
		if (providerRef) {
			const session =
				this.store?.findByPrefix(
					providerRef.providerId,
					providerRef.sessionId,
					tag,
				) ??
				(providerRef.providerId === this.state.providerId
					? this.matchCurrentSession(providerRef.sessionId, tag)
					: undefined);
			return session ? { status: "found", session } : { status: "not_found" };
		}

		if (!this.store) {
			const session = this.matchCurrentSession(selector, tag);
			return session ? { status: "found", session } : { status: "not_found" };
		}

		const persisted = this.store.findUniqueByPrefixAcrossProviders(
			selector,
			tag,
		);
		if (persisted.status !== "not_found") {
			return persisted;
		}
		const current = this.matchCurrentSession(selector, tag);
		return current ? { status: "found", session: current } : persisted;
	}

	clearActiveSession() {
		const previousProviderId = this.state.providerId;
		this.state.clearSession();
		this.store?.setActiveSessionId(previousProviderId, undefined);
		this.store?.setActiveChatProviderId(undefined);
		this.restoreBlankSelection();
		this.callbacks.onSessionStateChange?.();
		this.notifyActiveSessionChanged(undefined, previousProviderId);
	}

	deleteSession(sessionId: string): { clearedActiveSession: boolean } {
		const previousProviderId = this.state.providerId;
		const clearedActiveSession = this.state.sessionId === sessionId;
		this.store?.delete(previousProviderId, sessionId);
		if (clearedActiveSession) {
			this.state.clearSession();
			this.store?.setActiveSessionId(previousProviderId, undefined);
			this.store?.setActiveChatProviderId(undefined);
			this.restoreBlankSelection();
			this.callbacks.onSessionStateChange?.();
			this.notifyActiveSessionChanged(undefined, previousProviderId);
		}
		this.notifySessionCatalogChanged();
		return { clearedActiveSession };
	}

	deleteResolvedSession(session: SessionRow): {
		clearedActiveSession: boolean;
	} {
		const clearedActiveSession =
			this.state.providerId === session.providerId &&
			this.state.sessionId === session.sdkSessionId;
		const clearedProviderActive =
			this.store?.getActiveSessionId(session.providerId) ===
			session.sdkSessionId;
		this.store?.delete(session.providerId, session.sdkSessionId);
		if (clearedProviderActive) {
			this.store?.setActiveSessionId(session.providerId, undefined);
		}
		if (clearedActiveSession) {
			this.state.clearSession();
			this.store?.setActiveChatProviderId(undefined);
			this.restoreBlankSelection();
			this.callbacks.onSessionStateChange?.();
			this.notifyActiveSessionChanged(undefined, session.providerId);
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
		providerId?: string;
		title: string;
		model: string;
		serviceTier?: string;
		ocSessionId?: string;
		source: string;
		tag?: SessionTag;
	}) {
		const providerId = params.providerId ?? this.state.providerId;
		const existing = this.store?.get(providerId, params.event.sessionId);
		this.persistSession({
			providerId,
			sessionId: params.event.sessionId,
			ocSessionId: params.ocSessionId,
			title: existing?.title ?? params.title,
			model: params.model,
			serviceTier: params.serviceTier,
			source: params.source,
			tag: params.tag,
			usage: params.event.usage,
		});
		this.notifySessionCatalogChanged();
	}

	recordSessionInitialized(params: {
		active: boolean;
		providerId?: string;
		sessionId: string;
		title: string;
		model: string;
		serviceTier?: string;
		ocSessionId?: string;
		source: string;
		tag?: SessionTag;
	}) {
		const providerId = params.providerId ?? this.state.providerId;
		if (params.active) {
			this.state.initializeRun(params.sessionId, params.source);
			this.store?.setActiveSessionId(providerId, params.sessionId);
			this.store?.setActiveChatProviderId(providerId);
		}
		this.persistSession({ ...params, providerId });
		if (params.active) {
			this.callbacks.onSessionStateChange?.();
		}
		this.notifySessionCatalogChanged();
	}

	recordInterruptedRun(params: {
		providerId?: string;
		sessionId: string;
		title: string;
		model: string;
		serviceTier?: string;
		source: "agent" | "telegram" | "tui";
	}) {
		const providerId = params.providerId ?? this.state.providerId;
		this.store?.setActiveSessionId(providerId, params.sessionId);
		this.store?.setActiveChatProviderId(providerId);
		this.persistSession({ ...params, providerId });
		this.state.switchToSession(
			{
				agentId: "",
				providerId,
				sdkSessionId: params.sessionId,
				ocSessionId: params.sessionId,
				title: params.title,
				model: params.model,
				serviceTier: params.serviceTier,
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

	renameResolvedSession(session: SessionRow, title: string) {
		const isActiveSession =
			this.state.providerId === session.providerId &&
			this.state.sessionId === session.sdkSessionId;
		if (isActiveSession) {
			this.state.renameSession(session.sdkSessionId, title);
		}
		this.store?.rename(session.providerId, session.sdkSessionId, title);
		this.notifySessionRenamed(
			session.sdkSessionId,
			title,
			isActiveSession,
			session.providerId,
		);
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
		providerId?: string;
		sessionId: string;
		expectedTitle: string;
		title: string;
	}): boolean {
		if (!this.store) {
			return false;
		}

		const providerId = params.providerId ?? this.state.providerId;
		const renamed = this.store.applyAutoTitle({
			providerId,
			sdkSessionId: params.sessionId,
			expectedTitle: params.expectedTitle,
			title: params.title,
		});
		if (!renamed) {
			return false;
		}

		const isActiveSession =
			this.state.providerId === providerId &&
			this.state.sessionId === params.sessionId;
		if (isActiveSession) {
			this.state.renameSession(params.sessionId, params.title);
		}
		this.notifySessionRenamed(
			params.sessionId,
			params.title,
			isActiveSession,
			providerId,
		);
		if (isActiveSession) {
			this.callbacks.onSessionStateChange?.();
		}
		this.notifySessionCatalogChanged();
		return true;
	}

	markAutoTitleAttempted(
		sessionId: string,
		providerId = this.state.providerId,
	) {
		this.store?.markAutoTitleAttempted(providerId, sessionId);
	}

	switchToSession(selector: string): SessionRow | undefined {
		const resolved = this.resolveSession(selector, "chat");
		if (resolved.status !== "found") {
			return undefined;
		}
		return this.switchToResolvedSession(resolved.session);
	}

	switchToResolvedSession(session: SessionRow): SessionRow {
		this.state.switchToSession(
			session,
			this.store?.getUsage(session.providerId, session.sdkSessionId),
		);
		this.store?.setActiveSessionId(session.providerId, session.sdkSessionId);
		this.store?.setActiveChatProviderId(session.providerId);
		if (this.isWritableProvider(session.providerId)) {
			this.store?.setBlankChatModelSelection({
				providerId: session.providerId,
				model: session.model,
				effort: this.state.effort,
				...(session.serviceTier ? { serviceTier: session.serviceTier } : {}),
			});
		}
		this.callbacks.onSessionStateChange?.();
		this.notifyActiveSessionChanged(session.sdkSessionId, session.providerId);
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
		providerId?: string;
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
		const providerId = params.providerId ?? this.state.providerId;
		this.store?.upsert({
			providerId,
			sdkSessionId: params.sessionId,
			title: params.jobName,
			model: params.model,
			tag: "cron",
			timestamp: params.ranAt,
			failure: params.failure,
		});
		if (params.resultText !== undefined && params.resultText !== "") {
			this.store?.replaceTranscript(providerId, params.sessionId, [
				{
					role: "assistant",
					content: params.resultText,
					timestamp: params.ranAt,
				},
			]);
		}
	}

	async refreshTranscript(
		providerId: string,
		sessionId: string,
		readTranscript?: (sessionId: string) => Promise<TranscriptTurn[]>,
	) {
		if (!this.store || !readTranscript) {
			return;
		}

		const turns = await readTranscript(sessionId);
		this.store.replaceTranscript(providerId, sessionId, turns);
	}

	private persistActiveSession() {
		const sessionId = this.state.sessionId;
		if (!sessionId) {
			return;
		}

		const existing = this.store?.get(this.state.providerId, sessionId);
		this.store?.setActiveSessionId(this.state.providerId, sessionId);
		this.store?.setActiveChatProviderId(this.state.providerId);
		this.persistSession({
			sessionId,
			ocSessionId: this.state.ocSessionId,
			title: resolveSessionTitleForPersistence({
				existingTitle: existing?.title,
				fallbackSessionTitle: this.state.sessionTitleFallback,
				sessionTitle: this.state.sessionTitle,
			}),
			model: this.state.model,
			serviceTier: this.state.serviceTier,
			source: this.state.sessionSource,
			usage: this.state.usage,
		});
	}

	private persistSession(params: {
		providerId?: string;
		sessionId: string;
		ocSessionId?: string;
		title: string;
		model: string;
		serviceTier?: string;
		source: string;
		tag?: SessionTag;
		usage?: DoneEvent["usage"];
	}) {
		const providerId = params.providerId ?? this.state.providerId;
		this.store?.upsert({
			providerId,
			sdkSessionId: params.sessionId,
			ocSessionId: params.ocSessionId,
			title: params.title,
			model: params.model,
			serviceTier: params.serviceTier,
			source: params.source,
			tag: params.tag ?? "chat",
		});

		if (params.usage) {
			this.store?.setUsage(providerId, params.sessionId, params.usage);
		}
	}

	private restorePersistedState() {
		if (!this.store) {
			return;
		}
		const activeProviderId = this.resolvePersistedActiveProviderId();

		// First, honor any persisted blank-session selection so the runtime
		// reflects the user's last provider/model choice across daemon
		// restarts. The visible session — if any — overrides this below.
		this.restoreBlankSelection();

		const session = this.getActiveChatSession(activeProviderId);
		const activeSessionId = session?.sdkSessionId;
		const usage =
			session && activeSessionId
				? this.store.getUsage(activeProviderId, activeSessionId)
				: undefined;
		if (session) {
			this.state.setProvider(session.providerId);
			this.store.setActiveChatProviderId(session.providerId);
		} else {
			if (activeSessionId) {
				this.store.setActiveSessionId(activeProviderId, undefined);
			}
			if (this.store.getActiveChatProviderId()) {
				this.store.setActiveChatProviderId(undefined);
			}
		}

		this.state.restorePersistedState({
			lastUserTarget: this.store.getLastUserTarget(),
			session,
			usage,
		});
	}

	private resolvePersistedActiveProviderId(): string {
		const activeProviderId = this.store?.getActiveChatProviderId();
		if (activeProviderId) {
			if (this.getActiveChatSession(activeProviderId)) {
				return activeProviderId;
			}
			this.store?.setActiveChatProviderId(undefined);
		}

		const blankSelection = this.store?.getBlankChatModelSelection();
		if (
			blankSelection &&
			this.getActiveChatSession(blankSelection.providerId)
		) {
			return blankSelection.providerId;
		}

		const visibleActiveProviderId =
			this.store?.findVisibleActiveChatProviderId();
		if (visibleActiveProviderId) {
			return visibleActiveProviderId;
		}

		return this.state.providerId;
	}

	private getActiveChatSession(providerId: string): SessionRow | undefined {
		const activeSessionId = this.store?.getActiveSessionId(providerId);
		if (!activeSessionId) {
			return undefined;
		}

		const session = this.store?.get(providerId, activeSessionId);
		if (!session || session.tag !== "chat") {
			this.store?.setActiveSessionId(providerId, undefined);
			return undefined;
		}

		return session;
	}

	private applyBlankSelectionModel(model: string) {
		this.state.setProviderModel(model);
	}

	private restoreBlankSelection() {
		const blankSelection = this.resolveBlankSelection();
		if (!blankSelection) {
			return;
		}

		try {
			this.state.setProvider(blankSelection.providerId);
		} catch {
			// Setting the provider only fails when a session is already active.
			// Restore paths call this after clearing or during startup, but keep
			// this defensive so state restoration cannot crash future callers.
		}
		this.applyBlankSelectionModel(blankSelection.model);
		if (isEffortLevel(blankSelection.effort)) {
			this.state.setEffort(blankSelection.effort);
		}
		this.state.setServiceTier(blankSelection.serviceTier);
	}

	private resolveBlankSelection(): BlankChatModelSelection | undefined {
		const stored = this.store?.getBlankChatModelSelection();
		if (stored && this.isWritableProvider(stored.providerId)) {
			return stored;
		}

		const fallback = this.policy.defaultBlankSelection;
		if (!fallback) {
			return undefined;
		}
		if (stored) {
			this.store?.setBlankChatModelSelection(fallback);
		}
		return fallback;
	}

	private isWritableProvider(providerId: string): boolean {
		return (
			this.policy.writableProviderIds === undefined ||
			this.policy.writableProviderIds.has(providerId)
		);
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
			serviceTier: this.state.serviceTier,
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
		providerId = this.state.providerId,
	) {
		this.callbacks.onSessionRenamed?.({
			type: "session_renamed",
			sdkSessionId: sessionId,
			title,
			providerId,
			active,
		});
	}

	private notifyActiveSessionChanged(
		activeSessionId: string | undefined,
		providerId = this.state.providerId,
	) {
		if (!this.store) {
			return;
		}
		this.callbacks.onActiveSessionChanged?.({
			activeSessionId,
			providerId,
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
		providerId: session.providerId,
		sdkSessionId: session.sdkSessionId,
		title: session.title,
		model: session.model,
		lastActive: session.lastActive,
	};
}

function parseProviderSessionRef(
	selector: string,
): { providerId: string; sessionId: string } | undefined {
	const slash = selector.indexOf("/");
	if (slash <= 0 || slash === selector.length - 1) {
		return undefined;
	}
	return {
		providerId: selector.slice(0, slash),
		sessionId: selector.slice(slash + 1),
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
